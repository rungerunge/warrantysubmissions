import os
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from dotenv import load_dotenv
import pickle
import base64
from download_warranty_pdf import process_warranty_email
from datetime import datetime

# Load environment variables
load_dotenv()

# Gmail API setup
SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/spreadsheets'
]

def get_google_services():
    """Get or create Google API services."""
    creds = None
    
    # Load existing credentials if available
    if os.path.exists('token.pickle'):
        with open('token.pickle', 'rb') as token:
            creds = pickle.load(token)
    
    # Refresh/create credentials if needed
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_config({
                "installed": {
                    "client_id": os.getenv('GOOGLE_CLIENT_ID'),
                    "client_secret": os.getenv('GOOGLE_CLIENT_SECRET'),
                    "redirect_uris": [os.getenv('GOOGLE_REDIRECT_URI')],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token"
                }
            }, SCOPES)
            creds = flow.run_local_server(port=0)
        
        # Save credentials for future use
        with open('token.pickle', 'wb') as token:
            pickle.dump(creds, token)
    
    # Build both services
    gmail_service = build('gmail', 'v1', credentials=creds)
    sheets_service = build('sheets', 'v4', credentials=creds)
    
    return gmail_service, sheets_service

def append_to_sheets(sheets_service, data):
    """Append warranty submission data to Google Sheets."""
    try:
        spreadsheet_id = os.getenv('GOOGLE_SHEET_ID')
        range_name = 'Sheet1!A:Z'  # Adjust based on your sheet's structure
        
        # Prepare the row data
        row = [
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),  # Timestamp
            data.get('customer_name', ''),
            data.get('email', ''),
            data.get('phone', ''),
            data.get('address', ''),
            data.get('product_model', ''),
            data.get('serial_number', ''),
            data.get('purchase_date', ''),
            data.get('pdf_url', '')  # This will be the Drive link to the PDF
        ]
        
        body = {
            'values': [row]
        }
        
        result = sheets_service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption='RAW',
            insertDataOption='INSERT_ROWS',
            body=body
        ).execute()
        
        print(f"Successfully appended data to Google Sheets: {result}")
        return True
    
    except Exception as e:
        print(f"Error appending to Google Sheets: {e}")
        return False

def get_warranty_emails(service):
    """Fetch warranty form submission emails."""
    query = os.getenv('GMAIL_SEARCH_QUERY')
    retention_days = int(os.getenv('RETENTION_PERIOD', '5'))
    
    try:
        results = service.users().messages().list(
            userId='me',
            q=f"{query} newer_than:{retention_days}d"
        ).execute()
        
        messages = results.get('messages', [])
        return messages
    except Exception as e:
        print(f"Error fetching emails: {e}")
        return []

def process_email(gmail_service, sheets_service, message_id):
    """Process a single email and download its PDF."""
    try:
        # Get the email content
        message = gmail_service.users().messages().get(
            userId='me',
            id=message_id,
            format='full'
        ).execute()
        
        # Get email body
        if 'payload' in message and 'parts' in message['payload']:
            for part in message['payload']['parts']:
                if part['mimeType'] == 'text/html':
                    body = base64.urlsafe_b64decode(
                        part['body']['data'].encode('UTF-8')
                    ).decode('utf-8')
                    
                    # Process the warranty email and download PDF
                    result = process_warranty_email(body)
                    if result:
                        # Append data to Google Sheets
                        if append_to_sheets(sheets_service, result):
                            print(f"Successfully processed email {message_id} and updated sheets")
                        else:
                            print(f"Failed to update sheets for email {message_id}")
                    else:
                        print(f"Failed to process email {message_id}")
                    
                    return result
        
        print(f"No HTML content found in email {message_id}")
        return None
    
    except Exception as e:
        print(f"Error processing email {message_id}: {e}")
        return None

def main():
    """Main function to process warranty emails."""
    # Get Google services
    gmail_service, sheets_service = get_google_services()
    
    # Get warranty emails
    emails = get_warranty_emails(gmail_service)
    
    if not emails:
        print("No warranty form emails found")
        return
    
    print(f"Found {len(emails)} warranty form emails")
    
    # Process each email
    for email in emails:
        process_email(gmail_service, sheets_service, email['id'])

if __name__ == '__main__':
    main()