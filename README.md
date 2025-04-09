# Steadfast PDF to Image Converter & Sheet Populator

This Node.js application:

1. Converts PDFs from Google Drive to high-quality PNG images (using CloudConvert)
2. Extracts data from these images using Google Cloud Vision API 
3. Populates a specific tab in a Google Sheet with the extracted data

The script specifically processes PDF files that start with "SFWW PO# " and uses Google Secret Manager for securing API keys.

## Features

- Performs true PDF-to-image conversion (not just renaming files)
- Uses CloudConvert for high-quality, professional image conversion
- Extracts text from images using Google Cloud Vision OCR
- Parses data for multiple vendor formats:
  - Ripple Junction
  - FA World Entertainment
  - Violent Gentlemen
  - Baker Boys Distribution
  - Generic PO format
- Populates a Google Sheet with proper formatting
- Adds grand totals and spacing between PO groups
- Secure authentication using Google Secret Manager

## Prerequisites

1. Node.js 14 or higher
2. Google Cloud Platform account with:
   - Secret Manager API enabled
   - Google Drive API enabled 
   - Google Sheets API enabled
   - Google Vision API enabled
   - Service account with appropriate permissions
3. CloudConvert API key (stored in Secret Manager)
4. The following secrets in Google Secret Manager:
   - `cloudconvert-api-key` (note lowercase-hyphenated format)
   - `SFWW-AI-Primary-API-Key` (note Uppercase-Hyphenated format)
   - `SFWW-Core-Primary-API-Key` (note Uppercase-Hyphenated format)

## Installation

1. Clone this repository:
