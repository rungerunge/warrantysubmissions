require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// API setup
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Set credentials directly using refresh token
oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

// Create Gmail and Drive instances
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
const drive = google.drive({ version: 'v3', auth: oauth2Client });

// Function to decode base64Url to base64
const base64UrlToBase64 = (base64Url) => {
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return base64;
};

// Function to decode the globo URL
const decodeGloboUrl = (url) => {
    try {
        const extMatch = url.match(/ext=([^&]+)/);
        if (!extMatch) return null;

        const extParam = extMatch[1];
        const decoded = Buffer.from(extParam, 'base64').toString('utf-8');
        const linkMatch = decoded.match(/link=(.+)/);
        
        return linkMatch ? decodeURIComponent(linkMatch[1]) : null;
    } catch (error) {
        console.error('Error decoding URL:', error);
        return null;
    }
};

// Function to extract PDF URL from HTML
const extractPdfUrl = (html) => {
    try {
        const $ = cheerio.load(html);
        const pdfLink = $('a').filter((i, el) => $(el).text().endsWith('.pdf')).first();
        return pdfLink.length ? pdfLink.attr('href') : null;
    } catch (error) {
        console.error('Error extracting PDF URL:', error);
        return null;
    }
};

// Function to download PDF
const downloadPdf = async (url, outputDir = 'downloaded_pdfs') => {
    try {
        console.log('Attempting to download PDF from:', url);
        
        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Download the PDF with proper error handling
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            maxRedirects: 5,
            timeout: 10000, // 10 second timeout
            validateStatus: function (status) {
                return status >= 200 && status < 300; // Only accept success status codes
            }
        });

        // Verify we got a PDF
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.includes('pdf')) {
            console.error('Downloaded file is not a PDF:', contentType);
            return null;
        }

        // Get filename from Content-Disposition or URL
        let filename = 'warranty_form.pdf';
        const contentDisposition = response.headers['content-disposition'];
        if (contentDisposition) {
            const matches = contentDisposition.match(/filename=(.+)/);
            if (matches) {
                filename = matches[1].replace(/["']/g, '');
            }
        } else {
            const urlFilename = url.split('/').pop();
            if (urlFilename && urlFilename.endsWith('.pdf')) {
                filename = urlFilename;
            }
        }

        // Ensure filename is safe
        filename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');

        const outputPath = path.join(outputDir, filename);
        fs.writeFileSync(outputPath, response.data);
        console.log(`PDF downloaded successfully to: ${outputPath}`);
        return outputPath;
    } catch (error) {
        console.error('Error downloading PDF:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
        }
        return null;
    }
};

// Function to extract form data from email
const extractFormData = (html) => {
    try {
        const $ = cheerio.load(html);
        const formData = {
            date: '',
            name: '',
            address: '',
            zip: '',
            phone: '',
            email: '',
            dealer: '',
            model: '',
            length: '',
            weight: ''
        };

        // Extract data from the email content
        $('body').text().split('\n').forEach(line => {
            if (line.includes('Date and Year:')) formData.date = line.split(':')[1].trim();
            if (line.includes('Name:')) formData.name = line.split(':')[1].trim();
            if (line.includes('Address:')) formData.address = line.split(':')[1].trim();
            if (line.includes('ZIP:')) formData.zip = line.split(':')[1].trim();
            if (line.includes('Phone number:')) formData.phone = line.split(':')[1].trim();
            if (line.includes('Mail:')) formData.email = line.split(':')[1].trim();
            if (line.includes('Name of Dealer:')) formData.dealer = line.split(':')[1].trim();
            if (line.includes('Model:')) formData.model = line.split(':')[1].trim();
            if (line.includes('Nordic Length:')) formData.length = line.split(':')[1].trim();
            if (line.includes('Weight (AFTM)')) formData.weight = line.split(':')[1].trim();
        });

        return formData;
    } catch (error) {
        console.error('Error extracting form data:', error);
        return null;
    }
};

// Function to create folder in Google Drive
async function createFolder(parentFolderId, folderName) {
    try {
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId]
        };

        const response = await drive.files.create({
            resource: fileMetadata,
            fields: 'id'
        });

        return response.data.id;
    } catch (error) {
        console.error('Error creating folder:', error);
        throw error;
    }
}

// Function to upload file to Google Drive
async function uploadFile(folderId, filePath, fileName, mimeType) {
    try {
        const fileMetadata = {
            name: fileName,
            parents: [folderId]
        };

        const media = {
            mimeType,
            body: fs.createReadStream(filePath)
        };

        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
        });

        return response.data.id;
    } catch (error) {
        console.error('Error uploading file:', error);
        throw error;
    }
}

// Function to upload form data as text file
async function uploadFormDataAsText(folderId, formData, fileName) {
    try {
        const content = Object.entries(formData)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n');

        const tempPath = path.join('downloaded_pdfs', fileName);
        fs.writeFileSync(tempPath, content);

        await uploadFile(folderId, tempPath, fileName, 'text/plain');
        fs.unlinkSync(tempPath); // Clean up temp file
    } catch (error) {
        console.error('Error uploading form data:', error);
        throw error;
    }
}

// Function to process a single email
const processEmail = async (gmail, messageId) => {
    try {
        const message = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full'
        });

        // Find HTML part
        const parts = message.data.payload.parts || [];
        const htmlPart = parts.find(part => part.mimeType === 'text/html');

        if (!htmlPart || !htmlPart.body.data) {
            console.log(`No HTML content found in email ${messageId}`);
            return null;
        }

        // Decode email body
        const html = Buffer.from(base64UrlToBase64(htmlPart.body.data), 'base64').toString();
        
        // Extract form data
        const formData = extractFormData(html);
        if (!formData || !formData.name || !formData.email) {
            console.log(`Could not extract form data from email ${messageId}`);
            return null;
        }

        // Extract and process PDF URL
        const pdfUrl = extractPdfUrl(html);
        if (!pdfUrl) {
            console.log(`No PDF link found in email ${messageId}`);
            return null;
        }

        const actualPdfUrl = decodeGloboUrl(pdfUrl);
        if (!actualPdfUrl) {
            console.log(`Could not decode PDF URL from email ${messageId}`);
            return null;
        }

        // Download the PDF
        const pdfPath = await downloadPdf(actualPdfUrl);
        if (!pdfPath) {
            console.log(`Failed to download PDF from email ${messageId}`);
            return null;
        }

        // Create folder name with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const folderName = `${formData.name} - ${formData.email} - ${timestamp}`;

        // Create folder in Google Drive
        const folderId = await createFolder(process.env.GOOGLE_DRIVE_FOLDER_ID, folderName);

        // Upload PDF
        const pdfFileName = path.basename(pdfPath);
        await uploadFile(folderId, pdfPath, pdfFileName, 'application/pdf');

        // Upload form data as text file
        await uploadFormDataAsText(folderId, formData, 'form_data.txt');

        // Add retention date metadata (5 years from now)
        const retentionDate = new Date();
        retentionDate.setFullYear(retentionDate.getFullYear() + 5);
        
        // Update folder with retention date
        await drive.files.update({
            fileId: folderId,
            requestBody: {
                appProperties: {
                    retentionDate: retentionDate.toISOString(),
                    customerName: formData.name,
                    customerEmail: formData.email
                }
            }
        });

        console.log(`Successfully processed submission for ${formData.name}`);
        return true;
    } catch (error) {
        console.error(`Error processing email ${messageId}:`, error);
        return null;
    }
};

// Webhook endpoint for Gmail push notifications
app.post('/webhook/gmail', async (req, res) => {
    try {
        console.log('Received webhook notification:', req.body);
        
        // Verify the message is from Gmail
        if (!req.body || !req.body.message) {
            console.error('Invalid webhook payload');
            return res.status(400).send('Invalid payload');
        }

        // Process latest emails immediately
        await processLatestEmails();
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Internal error');
    }
});

// Function to process latest emails
async function processLatestEmails() {
    try {
        // Search for warranty emails from the last minute to ensure we don't miss any
        const oneMinuteAgo = Math.floor((Date.now() - 60000) / 1000);
        const query = `${process.env.GMAIL_SEARCH_QUERY} after:${oneMinuteAgo}`;
        
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: query
        });

        const messages = response.data.messages || [];
        console.log(`Found ${messages.length} new warranty form emails`);

        for (const message of messages) {
            await processEmail(gmail, message.id);
        }
    } catch (error) {
        console.error('Error processing latest emails:', error);
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// Initialize the app
async function init() {
    try {
        console.log('Starting application...');
        console.log('Project ID:', process.env.GOOGLE_PROJECT_ID);
        
        // Temporarily skip Gmail push notifications setup due to permissions
        console.log('Skipping Gmail push notifications setup temporarily');
        
        // Set up periodic email checking instead
        setInterval(async () => {
            try {
                await processLatestEmails();
            } catch (error) {
                console.error('Error in periodic email check:', error);
            }
        }, 60000); // Check every minute
        
        // Do an initial check for emails
        await processLatestEmails();
        
        // Start the server
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Error initializing app:', error);
        // Don't exit process on error, just log it
        console.log('Continuing without push notifications');
    }
}

init(); 