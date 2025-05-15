require('dotenv').config();
const { google } = require('googleapis');

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

// Create Drive instance
const drive = google.drive({ version: 'v3', auth: oauth2Client });

async function cleanupExpiredFiles() {
    try {
        console.log('Starting GDPR cleanup...');
        
        // Get all files in the warranty submissions folder
        const response = await drive.files.list({
            q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents`,
            fields: 'files(id, name, appProperties)',
            spaces: 'drive'
        });

        const now = new Date();
        const files = response.data.files;
        
        for (const file of files) {
            if (file.appProperties && file.appProperties.gdprExpiryDate) {
                const expiryDate = new Date(file.appProperties.gdprExpiryDate);
                
                if (now > expiryDate) {
                    console.log(`Deleting expired file: ${file.name}`);
                    await drive.files.delete({
                        fileId: file.id
                    });
                }
            }
        }
        
        console.log('GDPR cleanup completed');
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// Run cleanup
cleanupExpiredFiles(); 