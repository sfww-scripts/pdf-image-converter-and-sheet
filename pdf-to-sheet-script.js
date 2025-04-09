/**
 * Steadfast PDF to Image Converter & Sheet Populator
 * 
 * This script:
 * 1. Converts PDFs to proper images using CloudConvert
 * 2. Extracts data from images using Google Cloud Vision API
 * 3. Populates a specific Google Sheet with the extracted data
 * 
 * Authentication is managed via Google Secret Manager
 */

// Google Sheet ID to populate
const TARGET_SPREADSHEET_ID = '1-htxjzMg_4XK5ZsVxmksz1PIlJmkcagTxqp3xYNnQ7c';
const TARGET_SHEET_TAB_INDEX = 1; // 0-based index, so tab 2 is index 1

// Source and destination folder IDs
const SOURCE_FOLDER_ID = '1PRF8_32DL9CgRcpTmLaxs58rDxcZ4OtA';
const IMAGE_FOLDER_ID = '1jJO2zyCAFeP5dkA07opg4FgSi-vZR0n1';

// Google Cloud Project ID
const PROJECT_ID = '4704290793';

// Secret Manager secret names with exact case matching
const CLOUD_CONVERT_API_KEY_SECRET = 'cloudconvert-api-key';
const AI_API_KEY_SECRET = 'SFWW-AI-Primary-API-Key';
const CORE_API_KEY_SECRET = 'SFWW-Core-Primary-API-Key';
