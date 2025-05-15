import requests
import base64
import re
from urllib.parse import unquote
from bs4 import BeautifulSoup
import os
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
import pickle

def get_drive_service():
    """Get or create Google Drive API service."""
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
            }, ['https://www.googleapis.com/auth/drive.file'])
            creds = flow.run_local_server(port=0)
        
        # Save credentials for future use
        with open('token.pickle', 'wb') as token:
            pickle.dump(creds, token)
    
    return build('drive', 'v3', credentials=creds)

def upload_to_drive(file_path, folder_id=None):
    """Upload a file to Google Drive and return its URL."""
    try:
        drive_service = get_drive_service()
        
        file_metadata = {
            'name': os.path.basename(file_path)
        }
        
        if folder_id:
            file_metadata['parents'] = [folder_id]
        
        media = MediaFileUpload(
            file_path,
            mimetype='application/pdf',
            resumable=True
        )
        
        file = drive_service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id, webViewLink'
        ).execute()
        
        print(f"File uploaded to Drive: {file.get('webViewLink')}")
        return file.get('webViewLink')
    
    except Exception as e:
        print(f"Error uploading to Drive: {e}")
        return None

def extract_pdf_url_from_html(html_content):
    """Extract the PDF URL from the email HTML content."""
    soup = BeautifulSoup(html_content, 'html.parser')
    pdf_link = soup.find('a', text=lambda t: t and t.endswith('.pdf'))
    if pdf_link:
        return pdf_link.get('href')
    return None

def decode_globo_url(url):
    """Decode the globo URL to get the actual PDF URL."""
    # Extract the 'ext' parameter
    ext_match = re.search(r'ext=([^&]+)', url)
    if ext_match:
        ext_param = ext_match.group(1)
        # Decode base64
        try:
            decoded = base64.b64decode(ext_param).decode('utf-8')
            # Extract the actual URL from the 'link=' parameter
            link_match = re.search(r'link=(.+)', decoded)
            if link_match:
                return unquote(link_match.group(1))
        except Exception as e:
            print(f"Error decoding URL: {e}")
    return None

def download_pdf(url, output_dir="downloaded_pdfs"):
    """Download the PDF file following redirects."""
    try:
        # Create output directory if it doesn't exist
        os.makedirs(output_dir, exist_ok=True)

        # First request to get the redirect
        session = requests.Session()
        response = session.get(url, allow_redirects=True)
        
        # Get filename from Content-Disposition header or URL
        filename = None
        if 'Content-Disposition' in response.headers:
            cd = response.headers['Content-Disposition']
            if 'filename=' in cd:
                filename = re.findall("filename=(.+)", cd)[0].strip('"')
        
        if not filename:
            # Use the last part of the URL as filename
            filename = url.split('/')[-1]
            if not filename.endswith('.pdf'):
                filename = 'warranty_form.pdf'

        output_path = os.path.join(output_dir, filename)
        
        # Save the PDF
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        print(f"PDF downloaded successfully to: {output_path}")
        return output_path
    except Exception as e:
        print(f"Error downloading PDF: {e}")
        return None

def process_warranty_email(html_content):
    """Process warranty email HTML, download the PDF, and upload to Drive."""
    # Extract the initial URL
    pdf_url = extract_pdf_url_from_html(html_content)
    if not pdf_url:
        print("Could not find PDF link in email")
        return None
    
    # Decode the globo URL to get the actual PDF URL
    actual_pdf_url = decode_globo_url(pdf_url)
    if not actual_pdf_url:
        print("Could not decode PDF URL")
        return None
    
    # Download the PDF
    local_pdf_path = download_pdf(actual_pdf_url)
    if not local_pdf_path:
        return None
    
    # Upload to Drive
    drive_url = upload_to_drive(local_pdf_path, os.getenv('GOOGLE_DRIVE_FOLDER_ID'))
    if not drive_url:
        return None
    
    # Extract customer information from the email
    soup = BeautifulSoup(html_content, 'html.parser')
    customer_info = {
        'customer_name': '',
        'email': '',
        'phone': '',
        'address': '',
        'product_model': '',
        'serial_number': '',
        'purchase_date': '',
        'pdf_url': drive_url
    }
    
    # Add logic here to extract customer information from the email
    # This will depend on your email format
    
    return customer_info

# Example usage
if __name__ == "__main__":
    # Example HTML content (replace with actual email HTML)
    example_html = '''
    <a href="https://email.globosoftware.net/WGMRVTBFZCKE?id=63059=cRlRVQ4FBgYIRFULA1xTVwdZAlEBX1AEV1NaCARSUQYBXAdVCgIAAQFbVQoECghUBVROU1NcXUBTX19YR1teWFUlBghZX1odUlcLRAcOBVYCUwIBDggBAQQAAAUGT19CRhUSXxcZU15QUQoWUVVeAVgSXVRNTlJBUx9XVEAcYHF/NzcxenBscHp9WVFSRUdQ&fl=WhEVFUsMGRxQSBYWRlZGBkUHR15fVkFeGFJWXBscRFNAEwgGXRlSXEZWCldXXXcKWwQ=&ext=bGluaz1odHRwczovL2dsb2JvLnNmbzIuY2RuLmRpZ2l0YWxvY2VhbnNwYWNlcy5jb20vZmlsZXMvYWplbnNlbmZseWZpc2hpbmcubXlzaG9waWZ5LmNvbS9EU3prZW9HV0g2OUp0NGc5Z0dXYjczalNCbjA5TXA1WDcyUHA2bFBvLnBkZg==" target="_blank">Rechnung Nordic flies 21.04.2025.pdf</a>
    '''
    
    process_warranty_email(example_html) 