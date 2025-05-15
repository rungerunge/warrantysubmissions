# Warranty Submissions Processor

Automatically processes warranty form submissions from Gmail, uploads them to Google Drive, and handles GDPR compliance with 5-year data retention.

## Features

- Monitors Gmail for new warranty form submissions
- Downloads attached PDFs
- Creates organized folders in Google Drive
- Includes form data as text files
- Automatically deletes data after 5 years (GDPR compliance)
- Runs as a web service with scheduled tasks

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/rungerunge/warrantysubmissions.git
   cd warrantysubmissions
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with the following variables:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_REDIRECT_URI=https://developers.google.com/oauthplayground
   GOOGLE_REFRESH_TOKEN=your_refresh_token
   GOOGLE_DRIVE_FOLDER_ID=your_folder_id
   GMAIL_SEARCH_QUERY="subject:New Warranty Form Submission"
   RETENTION_PERIOD=5
   ```

4. Deploy to Render.com:
   - Connect your GitHub repository
   - Render will automatically use render.yaml configuration
   - Add environment variables in Render dashboard

## How It Works

- Checks for new warranty submissions every hour
- Creates a folder for each submission with format: `Name - email - timestamp`
- Stores both PDF and form data
- Runs daily cleanup to remove data older than 5 years
- Provides health check endpoint at `/health`

## Development

- `npm start`: Run the service
- `npm run cleanup`: Manually run GDPR cleanup

## GDPR Compliance

- All files are automatically tagged with creation date
- Cleanup script runs daily to remove files older than 5 years
- No personal data is stored in logs 