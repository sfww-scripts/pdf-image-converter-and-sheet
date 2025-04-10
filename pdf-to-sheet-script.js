<<<<<<< HEAD
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

/**
 * Main function to run the entire process
 */
async function main() {
  try {
    console.log("=== Starting PDF to Image Conversion and Sheet Population ===");
    
    // 1. Get secrets from Google Secret Manager
    const cloudConvertApiKey = await getSecret(CLOUD_CONVERT_API_KEY_SECRET);
    const aiApiKey = await getSecret(AI_API_KEY_SECRET);
    const coreApiKey = await getSecret(CORE_API_KEY_SECRET);
    
    // 2. Initialize API clients
    const drive = await getDriveClient(coreApiKey);
    const vision = getVisionClient(aiApiKey);
    const sheets = await getSheetsClient(coreApiKey);
    const cloudConvert = getCloudConvertClient(cloudConvertApiKey);
    
    // 3. Get the source folder and find PDFs that start with "SFWW PO# "
    console.log("Scanning source folder for PDFs...");
    const pdfs = await listPdfFiles(drive, SOURCE_FOLDER_ID, "SFWW PO# ");
    console.log(`Found ${pdfs.length} PDFs starting with "SFWW PO# "`);
    
    // 4. Create/get the image folder
    const imageFolder = await getOrCreateFolder(drive, IMAGE_FOLDER_ID);
    
    // 5. Process each PDF: convert to image, extract data, and populate sheet
    for (const pdf of pdfs) {
      console.log(`Processing PDF: ${pdf.name}`);
      
      // 5a. Convert PDF to image (using CloudConvert for high-quality conversion)
      const imagePath = await convertPdfToImage(cloudConvert, drive, pdf, imageFolder);
      
      // 5b. Extract text from the image using Vision API
      const extractedText = await extractTextFromImage(vision, drive, imagePath);
      
      // 5c. Parse the extracted text to get structured data
      const parsedData = parseDataFromText(extractedText);
      
      // 5d. Update the target Google Sheet with the parsed data
      await updateSpreadsheet(sheets, TARGET_SPREADSHEET_ID, TARGET_SHEET_TAB_INDEX, parsedData, pdf.name);
    }
    
    console.log("=== PDF to Image Conversion and Sheet Population Complete ===");
    return {
      status: "success",
      message: `Processed ${pdfs.length} PDFs and populated the spreadsheet.`
    };
  } catch (error) {
    console.error("Error in main function:", error);
    return {
      status: "error",
      message: error.message
    };
  }
}

/**
 * Get a secret from Google Secret Manager
 */
async function getSecret(secretName) {
  try {
    const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();
    
    // Use exact case matching for secret names
    const name = `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`;
    
    const [response] = await client.accessSecretVersion({name});
    console.log(`Successfully retrieved secret: ${secretName}`);
    return response.payload.data.toString('utf8');
  } catch (error) {
    if (error.code === 5) { // NOT_FOUND in gRPC
      console.error(`Secret not found. Check case sensitivity of: ${secretName}`);
    } else {
      console.error(`Error retrieving secret: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get an authenticated Google Drive client
 */
async function getDriveClient(apiKey) {
  const {google} = require('googleapis');
  
  // Create a JWT auth client using service account credentials
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  
  const authClient = await auth.getClient();
  return google.drive({version: 'v3', auth: authClient});
}

/**
 * Get Google Vision API client
 */
function getVisionClient(apiKey) {
  const {ImageAnnotatorClient} = require('@google-cloud/vision');
  return new ImageAnnotatorClient({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
  });
}

/**
 * Get an authenticated Google Sheets client
 */
async function getSheetsClient(apiKey) {
  const {google} = require('googleapis');
  
  // Create a JWT auth client using service account credentials
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  
  const authClient = await auth.getClient();
  return google.sheets({version: 'v4', auth: authClient});
}

/**
 * Get a CloudConvert client
 */
function getCloudConvertClient(apiKey) {
  const CloudConvert = require('cloudconvert');
  return new CloudConvert(apiKey);
}

/**
 * List PDF files in a Google Drive folder, optionally filtering by prefix
 */
async function listPdfFiles(drive, folderId, prefix = null) {
  try {
    let query = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
    
    // If a prefix is provided, add it to the query
    if (prefix) {
      query += ` and name starts with '${prefix}'`;
    }
    
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType)',
      pageSize: 1000
    });
    
    return response.data.files || [];
  } catch (error) {
    console.error('Error listing PDF files:', error);
    throw error;
  }
}

/**
 * Get a folder by ID or create it if it doesn't exist
 */
async function getOrCreateFolder(drive, folderId) {
  try {
    // Try to get the folder first
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id, name'
    });
    
    return {
      id: response.data.id,
      name: response.data.name
    };
  } catch (error) {
    // If the folder doesn't exist, create it
    if (error.code === 404) {
      const response = await drive.files.create({
        resource: {
          name: 'Converted Images',
          mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id, name'
      });
      
      return {
        id: response.data.id,
        name: response.data.name
      };
    }
    
    throw error;
  }
}

/**
 * Convert a PDF to a high-quality image using CloudConvert
 */
async function convertPdfToImage(cloudConvert, drive, pdfFile, imageFolder) {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmpDir = os.tmpdir();
    
    // Step 1: Download the PDF from Google Drive
    console.log(`Downloading ${pdfFile.name}...`);
    const tempPdfPath = path.join(tmpDir, pdfFile.name);
    await downloadFile(drive, pdfFile.id, tempPdfPath);
    
    // Step 2: Prepare the output file name
    const baseName = pdfFile.name.replace(/\.pdf$/i, '');
    const outputImageName = `${baseName}_image.png`;
    const outputImagePath = path.join(tmpDir, outputImageName);
    
    // Step 3: Convert PDF to image using CloudConvert
    console.log(`Converting ${pdfFile.name} to image...`);
    await convertWithCloudConvert(cloudConvert, tempPdfPath, outputImagePath);
    
    // Step 4: Upload the converted image to Google Drive
    console.log(`Uploading ${outputImageName} to Google Drive...`);
    const uploadedImage = await uploadFileToDrive(drive, outputImagePath, outputImageName, imageFolder.id);
    
    // Step 5: Clean up temporary files
    fs.unlinkSync(tempPdfPath);
    fs.unlinkSync(outputImagePath);
    
    console.log(`Converted ${pdfFile.name} to image: ${outputImageName}`);
    return uploadedImage;
  } catch (error) {
    console.error(`Error converting PDF to image ${pdfFile.name}:`, error);
    throw error;
  }
}

/**
 * Convert a PDF to an image using CloudConvert
 */
async function convertWithCloudConvert(cloudConvert, pdfPath, outputPath) {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Create conversion job
    const job = await cloudConvert.jobs.create({
      tasks: {
        'import-pdf': {
          operation: 'import/upload'
        },
        'convert-to-png': {
          operation: 'convert',
          input: 'import-pdf',
          output_format: 'png',
          engine: 'graphicsmagick',
          page_range: '1',  // Only first page
          density: 300,     // High quality
          quality: 100,     // Best quality
          flatten: true     // Flatten transparency
        },
        'export-png': {
          operation: 'export/url',
          input: 'convert-to-png'
        }
      }
    });
    
    // Upload the PDF
    const importTask = job.tasks.filter(task => task.name === 'import-pdf')[0];
    const inputFile = fs.createReadStream(pdfPath);
    
    await cloudConvert.tasks.upload(importTask, inputFile, path.basename(pdfPath));
    
    // Wait for the job to complete
    const jobResult = await cloudConvert.jobs.wait(job.id);
    
    // Get the export task
    const exportTask = jobResult.tasks.filter(task => task.name === 'export-png')[0];
    
    if (!exportTask || exportTask.status !== 'finished') {
      throw new Error('Export task did not complete successfully');
    }
    
    // Download the converted image
    const file = exportTask.result.files[0];
    const axios = require('axios');
    const writer = fs.createWriteStream(outputPath);
    
    const response = await axios({
      method: 'GET',
      url: file.url,
      responseType: 'stream'
    });
    
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('Error converting with CloudConvert:', error);
    throw error;
  }
}

/**
 * Download a file from Google Drive
 */
async function downloadFile(drive, fileId, destination) {
  try {
    const fs = require('fs');
    const {Readable} = require('stream');
    const {pipeline} = require('stream/promises');
    
    const response = await drive.files.get(
      {fileId, alt: 'media'},
      {responseType: 'stream'}
    );
    
    const writeStream = fs.createWriteStream(destination);
    await pipeline(response.data, writeStream);
  } catch (error) {
    console.error(`Error downloading file ${fileId}:`, error);
    throw error;
  }
}

/**
 * Upload a file to Google Drive
 */
async function uploadFileToDrive(drive, filePath, fileName, folderId) {
  try {
    const fs = require('fs');
    
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };
    
    const media = {
      mimeType: 'image/png',
      body: fs.createReadStream(filePath)
    };
    
    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink'
    });
    
    return {
      id: response.data.id,
      name: response.data.name,
      link: response.data.webViewLink
    };
  } catch (error) {
    console.error(`Error uploading file ${fileName}:`, error);
    throw error;
  }
}

/**
 * Extract text from an image using Google Cloud Vision API
 */
async function extractTextFromImage(vision, drive, image) {
  try {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpDir = os.tmpdir();
    
    // Download the image file
    const tempImagePath = path.join(tmpDir, image.name);
    await downloadFile(drive, image.id, tempImagePath);
    
    // Read the file into a buffer
    const imageBuffer = fs.readFileSync(tempImagePath);
    
    // Perform text detection on the image
    const [result] = await vision.textDetection(imageBuffer);
    const detections = result.textAnnotations;
    
    // Clean up the temporary file
    fs.unlinkSync(tempImagePath);
    
    // Extract the full text from the first annotation (if available)
    if (detections && detections.length > 0) {
      return detections[0].description;
    }
    
    return '';
  } catch (error) {
    console.error(`Error extracting text from image ${image.name}:`, error);
    throw error;
  }
}

/**
 * Parse data from extracted text
 * This function is adapted from your existing code but simplified for this script
 */
function parseDataFromText(text) {
  if (!text || text.trim().length === 0) {
    console.log("Empty text provided to parser");
    return [];
  }

  const items = [];
  
  // Check for specific vendor formats and use specialized parsers
  if (text.includes('RIPPLE JUNCTION') || text.includes('ZQBQ')) {
    return parseRippleJunctionPO(text);
  }
  
  if (text.includes('FA World Entertainment')) {
    return parseFAWorldPO(text);
  }
  
  if (text.includes('Violent Gentlemen')) {
    return parseViolentGentlemenPO(text);
  }
  
  // For Baker Boys Distribution
  if (text.includes('Baker Boys Distribution')) {
    return parseBakerBoysPO(text);
  }
  
  // Generic fallback parser
  return parseGenericPO(text);
}

/**
 * Parse Ripple Junction PO data
 */
function parseRippleJunctionPO(text) {
  const items = [];
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/(\d{6})\s+REVISION/);
  if (poMatch) {
    poNumber = poMatch[1];
  }
  
  // Extract items (simplified from your original code)
  const pattern = /ZQBQ\d+[A-Z]*\s+001\s+BLACK\s+\d+\s+GODZILLA[\s-]*CLASSIC[\s-]*KING[\s-]*OF[\s-]*MINI\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)/gi;
  
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const styleMatch = match[0].match(/ZQBQ\d+[A-Z]*/);
    if (!styleMatch) continue;
    
    const style = styleMatch[0];
    const qty = parseInt(match[1]);
    const unitPrice = parseFloat(match[2].replace(',', ''));
    const totalAmount = parseFloat(match[3].replace(',', ''));
    
    items.push({
      customer: 'Ripple Junction',
      po: poNumber,
      style: style,
      description: 'GODZILLA CLASSIC KING OF MINI BACKPACK',
      qty: qty,
      unit_price: unitPrice,
      total_amount: totalAmount
    });
  }
  
  return items;
}

/**
 * Parse FA World PO data
 */
function parseFAWorldPO(text) {
  const items = [];
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/PO\s+(\d+)/);
  if (poMatch) {
    poNumber = poMatch[1];
  }
  
  // Find Pile Fleece Overshirt
  const pileFleeceLine = text.match(/Pile Fleece Overshirt[\s\S]+?Black - Black[\s]+(\d+)[\s]+([\d,.]+\.\d+)/i);
  if (pileFleeceLine) {
    const qty = parseInt(pileFleeceLine[1]);
    const totalAmount = parseFloat(pileFleeceLine[2].replace(/,/g, ''));
    
    const unitPriceParts = text.match(/Pile Fleece Overshirt[\s\S]+?Xs[\s\n]+\d+[\s\n]+(\d+\.\d+)/i);
    const unitPrice = unitPriceParts ? parseFloat(unitPriceParts[1]) : (totalAmount / qty);
    
    items.push({
      customer: 'FA World Entertainment',
      po: poNumber,
      style: 'PILE-FLEECE-OVERSHIRT',
      description: 'PILE FLEECE OVERSHIRT (Black - Black)',
      qty: qty,
      unit_price: unitPrice,
      total_amount: totalAmount
    });
  }
  
  // Find Corduroy Lounge Pants
  const corduroyLine = text.match(/Corduroy Lounge Pants - Fall 25[\s\S]+?Brown - Brown[\s]+(\d+)[\s]+([\d,.]+\.\d+)/i);
  if (corduroyLine) {
    const qty = parseInt(corduroyLine[1]);
    const totalAmount = parseFloat(corduroyLine[2].replace(/,/g, ''));
    
    const unitPriceParts = text.match(/Corduroy Lounge Pants[\s\S]+?Xs[\s\n]+\d+[\s\n]+(\d+\.\d+)/i);
    const unitPrice = unitPriceParts ? parseFloat(unitPriceParts[1]) : (totalAmount / qty);
    
    items.push({
      customer: 'FA World Entertainment',
      po: poNumber,
      style: 'CORDUROY-LOUNGE-PANTS-FALL25',
      description: 'CORDUROY LOUNGE PANTS FALL25 (Brown - Brown)',
      qty: qty,
      unit_price: unitPrice,
      total_amount: totalAmount
    });
  }
  
  return items;
}

/**
 * Parse Violent Gentlemen PO data
 */
function parseViolentGentlemenPO(text) {
  const items = [];
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/Purchase Order#\s*([^\s]+)/);
  if (poMatch) {
    poNumber = poMatch[1];
  }
  
  // Extract items (simplified version)
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const standardItemRegex = /^([A-Za-z\s]+)\s+([A-Z0-9-]+)\s+([A-Za-z\s]+)\s+([A-Za-z\s]+)(\s+\d+){5,8}\s+(\d+)\s+\$([\d.]+)\s+\$([\d,.]+)(.*)/;
    const standardMatch = line.match(standardItemRegex);
    
    if (standardMatch) {
      const styleName = standardMatch[1].trim();
      const styleNumber = standardMatch[2].trim();
      const totalQty = parseInt(standardMatch[6]);
      const unitPrice = parseFloat(standardMatch[7]);
      const totalAmount = parseFloat(standardMatch[8].replace(',', ''));
      
      items.push({
        customer: 'Violent Gentlemen',
        po: poNumber,
        style: styleNumber,
        description: styleName,
        qty: totalQty,
        unit_price: unitPrice,
        total_amount: totalAmount
      });
      
      // Check for oversize data in the remaining text
      const remainingText = standardMatch[9].trim();
      const oversizeMatch = remainingText.match(/(\d+)\s+\d+\s+\$([\d.]+)\s+\$([\d,.]+)/);
      if (oversizeMatch) {
        const oversizeQty = parseInt(oversizeMatch[1]);
        const oversizePrice = parseFloat(oversizeMatch[2]);
        const oversizeTotal = parseFloat(oversizeMatch[3].replace(',', ''));
        
        items.push({
          customer: 'Violent Gentlemen',
          po: poNumber,
          style: `${styleNumber}-OVERSIZE`,
          description: `${styleName} - OVERSIZE`,
          qty: oversizeQty,
          unit_price: oversizePrice,
          total_amount: oversizeTotal
        });
      }
    }
  }
  
  return items;
}

/**
 * Parse Baker Boys Distribution PO data
 */
function parseBakerBoysPO(text) {
  const items = [];
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/P\.O\. Number:\s*([^\s]+)/);
  if (poMatch) {
    poNumber = poMatch[1];
  }
  
  // Extract items
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const styleMatch = line.match(/^([0-9-]+)\s+EACH\s+(\d+)\s+\d+\s+\d+\s+([\d.]+)\s+([\d,.]+)\s+(.+)/);
    if (styleMatch) {
      const [, itemCode, qty, unitPrice, totalAmount, description] = styleMatch;
      
      items.push({
        customer: 'Baker Boys Distribution',
        po: poNumber,
        style: itemCode,
        description: description.split('Whse:')[0].trim(),
        qty: parseInt(qty),
        unit_price: parseFloat(unitPrice),
        total_amount: parseFloat(totalAmount.replace(',', ''))
      });
    }
  }
  
  return items;
}

/**
 * Generic parser for other PO types
 */
function parseGenericPO(text) {
  // Extract customer name
  let customer = 'Unknown';
  
  // Try to extract from various formats
  const customerMatch = text.match(/Customer:\s*([^\n]+)/i) || 
                         text.match(/SOLD\s+TO:\s*([^\n]+)/i) ||
                         text.match(/BILL\s+TO:\s*([^\n]+)/i);
  
  if (customerMatch) {
    customer = customerMatch[1].trim();
  }
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/P\.?O\.?\s*(?:Number|#)?\s*:?\s*([A-Z0-9\-]+)/i) ||
                    text.match(/Purchase\s+Order\s*(?:Number|#)?\s*:?\s*([A-Z0-9\-]+)/i);
  
  if (poMatch) {
    poNumber = poMatch[1].trim();
  }
  
  // Try to extract items using generic patterns
  const items = [];
  const lines = text.split('\n');
  
  // Look for lines with qty, unit price and total patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Match patterns with item number, quantity, unit price, and total
    const itemMatch = line.match(/([A-Z0-9\-]+)\s+.*?(\d+)\s+.*?\$([\d,.]+)\s+.*?\$([\d,.]+)/i);
    
    if (itemMatch) {
      const [, style, qty, unitPrice, totalAmount] = itemMatch;
      
      // Try to find a description in the next line or same line
      let description = '';
      if (i + 1 < lines.length && !lines[i + 1].match(/\$/)) {
        description = lines[i + 1].trim();
      } else {
        // Extract description from current line by removing the matched parts
        description = line.replace(style, '').replace(/\d+/, '').replace(/\$[\d,.]+/g, '').trim();
      }
      
      items.push({
        customer,
        po: poNumber,
        style,
        description,
        qty: parseInt(qty),
        unit_price: parseFloat(unitPrice.replace(',', '')),
        total_amount: parseFloat(totalAmount.replace(',', ''))
      });
    }
  }
  
  return items;
}

/**
 * Update the spreadsheet with the parsed data
 */
async function updateSpreadsheet(sheets, spreadsheetId, sheetIndex, parsedData, fileName) {
  try {
    if (!parsedData || parsedData.length === 0) {
      console.log(`No data to write for ${fileName}`);
      return;
    }
    
    // Get the SFWW PO# from the filename
    const poMatch = fileName.match(/SFWW PO# (\d+)/);
    const sfwwPoNumber = poMatch ? poMatch[1] : "Unknown";
    
    // Get the sheet metadata to find the next empty row
    const metaResponse = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false
    });
    
    const sheetId = metaResponse.data.sheets[sheetIndex].properties.sheetId;
    const sheetTitle = metaResponse.data.sheets[sheetIndex].properties.title;
    
    // Get the current data to find the last row
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetTitle}!A:A`
    });
    
    const rows = dataResponse.data.values || [];
    let nextRow = rows.length + 1;
    
    // If there's a header row, but no data, start at row 2
    if (rows.length === 1) {
      nextRow = 2;
    } else if (rows.length === 0) {
      // If sheet is completely empty, add a header row first
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetTitle}!A1:I1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            "SFWW PO#", "SFWW INVOICE#", "CUSTOMER", "CUSTOMER PO#", 
            "STYLE# or ITEM#", "DESCR or STYLE NAME", "TOTAL QTY ORDERED", 
            "UNIT PRICE", "TOTAL PO AMOUNT"
          ]]
        }
      });
      
      // Format the header row
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              updateCells: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 9
                },
                rows: [
                  {
                    values: Array(9).fill({
                      userEnteredFormat: {
                        backgroundColor: { red: 0, green: 0, blue: 0 },
                        textFormat: { 
                          foregroundColor: { red: 1, green: 1, blue: 0 },
                          bold: true
                        },
                        horizontalAlignment: 'CENTER',
                        wrapStrategy: 'WRAP'
                      }
                    })
                  }
                ],
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)'
              }
            }
          ]
        }
      });
      
      nextRow = 2;
    }
    
    // Prepare the values to insert
    const valuesToInsert = parsedData.map(item => [
      sfwwPoNumber,                   // A: SFWW PO#
      sfwwPoNumber,                   // B: SFWW INVOICE#
      item.customer || '',            // C: Customer
      item.po || '',                  // D: PO#
      item.style || '',               // E: Style#/Item#
      item.description || '',         // F: Description
      item.qty || '',                 // G: Total Qty
      item.unit_price || '',          // H: Unit Price
      item.total_amount || ''         // I: TOTAL PO AMOUNT
    ]);
    
    // Insert the values
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A${nextRow}:I${nextRow + valuesToInsert.length - 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: valuesToInsert
      }
    });
    
    // Calculate totals
    const totalQty = parsedData.reduce((sum, item) => sum + (item.qty || 0), 0);
    const totalAmount = parsedData.reduce((sum, item) => sum + (item.total_amount || 0), 0);
    
    // Insert the grand total row
    const totalRow = nextRow + valuesToInsert.length;
    
    // Update the grand total row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A${totalRow}:I${totalRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          '', '', '', '', '', 'GRAND TOTAL', totalQty, '', totalAmount
        ]]
      }
    });
    
    // Format the grand total row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            // Black background for the entire row
            updateCells: {
              range: {
                sheetId,
                startRowIndex: totalRow - 1,
                endRowIndex: totalRow,
                startColumnIndex: 0,
                endColumnIndex: 9
              },
              rows: [
                {
                  values: Array(9).fill({
                    userEnteredFormat: {
                      backgroundColor: { red: 0, green: 0, blue: 0 },
                      textFormat: { 
                        foregroundColor: { red: 1, green: 1, blue: 1 },
                      }
                    }
                  })
                }
              ],
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          },
          {
            // Right align the "GRAND TOTAL" text
            updateCells: {
              range: {
                sheetId,
                startRowIndex: totalRow - 1,
                endRowIndex: totalRow,
                startColumnIndex: 5,
                endColumnIndex: 6
              },
              rows: [
                {
                  values: [
                    {
                      userEnteredFormat: {
                        horizontalAlignment: 'RIGHT',
                      }
                    }
                  ]
                }
              ],
              fields: 'userEnteredFormat(horizontalAlignment)'
            }
          },
          {
            // Format the total amount column as currency
            updateCells: {
              range: {
                sheetId,
                startRowIndex: nextRow - 1,
                endRowIndex: totalRow,
                startColumnIndex: 7,
                endColumnIndex: 9
              },
              rows: Array(totalRow - nextRow + 1).fill({
                values: Array(2).fill({
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'CURRENCY',
                      pattern: '$#,##0.00'
                    }
                  }
                })
              }),
              fields: 'userEnteredFormat(numberFormat)'
            }
          },
          {
            // Center align all data in the table
            updateCells: {
              range: {
                sheetId,
                startRowIndex: nextRow - 1,
                endRowIndex: totalRow - 1,
                startColumnIndex: 0,
                endColumnIndex: 9
              },
              rows: Array(totalRow - nextRow).fill({
                values: Array(9).fill({
                  userEnteredFormat: {
                    horizontalAlignment: 'CENTER'
                  }
                })
              }),
              fields: 'userEnteredFormat(horizontalAlignment)'
            }
          }
        ]
      }
    });
    
    console.log(`Updated spreadsheet with ${parsedData.length} items from ${fileName}`);
    
    // Add empty rows between PO groups if this isn't the first group
    if (nextRow > 2) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex: totalRow,
                  endIndex: totalRow + 5
                },
                inheritFromBefore: false
              }
            }
          ]
        }
      });
    }
    
    return {
      rowsAdded: valuesToInsert.length + 1, // +1 for the grand total row
      totalItems: parsedData.length,
      totalQuantity: totalQty,
      totalAmount: totalAmount
    };
  } catch (error) {
    console.error(`Error updating spreadsheet for ${fileName}:`, error);
    throw error;
  }
}

/**
 * Command-line script to run the process
 */
async function runCommand() {
  try {
    // Get command line arguments
    const argv = require('yargs')
      .option('source', {
        alias: 's',
        description: 'Source folder ID containing PDFs',
        default: SOURCE_FOLDER_ID
      })
      .option('images', {
        alias: 'i',
        description: 'Destination folder ID for images',
        default: IMAGE_FOLDER_ID
      })
      .option('spreadsheet', {
        alias: 'ss',
        description: 'Target spreadsheet ID',
        default: TARGET_SPREADSHEET_ID
      })
      .option('tab', {
        alias: 't',
        description: 'Tab index in the spreadsheet (0-based)',
        default: TARGET_SHEET_TAB_INDEX
      })
      .option('prefix', {
        alias: 'p',
        description: 'File prefix to filter by (e.g., "SFWW PO# ")',
        default: 'SFWW PO# '
      })
      .help()
      .alias('help', 'h')
      .argv;
    
    // Override global constants with command line arguments
    SOURCE_FOLDER_ID = argv.source;
    IMAGE_FOLDER_ID = argv.images;
    TARGET_SPREADSHEET_ID = argv.spreadsheet;
    TARGET_SHEET_TAB_INDEX = argv.tab;
    
    // Run the main function
    const result = await main();
    console.log(JSON.stringify(result, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Export functions for testing or importing
module.exports = {
  main,
  getSecret,
  convertPdfToImage,
  extractTextFromImage,
  parseDataFromText,
  updateSpreadsheet
};

// Run the script if called directly
if (require.main === module) {
  runCommand();
}
=======
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

/**
 * Main function to run the entire process
 */
async function main() {
  try {
    console.log("=== Starting PDF to Image Conversion and Sheet Population ===");
    
    // 1. Get secrets from Google Secret Manager
    const cloudConvertApiKey = await getSecret(CLOUD_CONVERT_API_KEY_SECRET);
    const aiApiKey = await getSecret(AI_API_KEY_SECRET);
    const coreApiKey = await getSecret(CORE_API_KEY_SECRET);
    
    // 2. Initialize API clients
    const drive = await getDriveClient(coreApiKey);
    const vision = getVisionClient(aiApiKey);
    const sheets = await getSheetsClient(coreApiKey);
    const cloudConvert = getCloudConvertClient(cloudConvertApiKey);
    
    // 3. Get the source folder and find PDFs that start with "SFWW PO# "
    console.log("Scanning source folder for PDFs...");
    const pdfs = await listPdfFiles(drive, SOURCE_FOLDER_ID, "SFWW PO# ");
    console.log(`Found ${pdfs.length} PDFs starting with "SFWW PO# "`);
    
    // 4. Create/get the image folder
    const imageFolder = await getOrCreateFolder(drive, IMAGE_FOLDER_ID);
    
    // 5. Process each PDF: convert to image, extract data, and populate sheet
    for (const pdf of pdfs) {
      console.log(`Processing PDF: ${pdf.name}`);
      
      // 5a. Convert PDF to image (using CloudConvert for high-quality conversion)
      const imagePath = await convertPdfToImage(cloudConvert, drive, pdf, imageFolder);
      
      // 5b. Extract text from the image using Vision API
      const extractedText = await extractTextFromImage(vision, drive, imagePath);
      
      // 5c. Parse the extracted text to get structured data
      const parsedData = parseDataFromText(extractedText);
      
      // 5d. Update the target Google Sheet with the parsed data
      await updateSpreadsheet(sheets, TARGET_SPREADSHEET_ID, TARGET_SHEET_TAB_INDEX, parsedData, pdf.name);
    }
    
    console.log("=== PDF to Image Conversion and Sheet Population Complete ===");
    return {
      status: "success",
      message: `Processed ${pdfs.length} PDFs and populated the spreadsheet.`
    };
  } catch (error) {
    console.error("Error in main function:", error);
    return {
      status: "error",
      message: error.message
    };
  }
}

/**
 * Get a secret from Google Secret Manager
 */
async function getSecret(secretName) {
  try {
    const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();
    
    // Use exact case matching for secret names
    const name = `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`;
    
    const [response] = await client.accessSecretVersion({name});
    console.log(`Successfully retrieved secret: ${secretName}`);
    return response.payload.data.toString('utf8');
  } catch (error) {
    if (error.code === 5) { // NOT_FOUND in gRPC
      console.error(`Secret not found. Check case sensitivity of: ${secretName}`);
    } else {
      console.error(`Error retrieving secret: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get an authenticated Google Drive client
 */
async function getDriveClient(apiKey) {
  const {google} = require('googleapis');
  
  // Create a JWT auth client using service account credentials
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  
  const authClient = await auth.getClient();
  return google.drive({version: 'v3', auth: authClient});
}

/**
 * Get Google Vision API client
 */
function getVisionClient(apiKey) {
  const {ImageAnnotatorClient} = require('@google-cloud/vision');
  return new ImageAnnotatorClient({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
  });
}

/**
 * Get an authenticated Google Sheets client
 */
async function getSheetsClient(apiKey) {
  const {google} = require('googleapis');
  
  // Create a JWT auth client using service account credentials
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  
  const authClient = await auth.getClient();
  return google.sheets({version: 'v4', auth: authClient});
}

/**
 * Get a CloudConvert client
 */
function getCloudConvertClient(apiKey) {
  const CloudConvert = require('cloudconvert');
  return new CloudConvert(apiKey);
}

/**
 * List PDF files in a Google Drive folder, optionally filtering by prefix
 */
async function listPdfFiles(drive, folderId, prefix = null) {
  try {
    let query = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
    
    // If a prefix is provided, add it to the query
    if (prefix) {
      query += ` and name starts with '${prefix}'`;
    }
    
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType)',
      pageSize: 1000
    });
    
    return response.data.files || [];
  } catch (error) {
    console.error('Error listing PDF files:', error);
    throw error;
  }
}

/**
 * Get a folder by ID or create it if it doesn't exist
 */
async function getOrCreateFolder(drive, folderId) {
  try {
    // Try to get the folder first
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id, name'
    });
    
    return {
      id: response.data.id,
      name: response.data.name
    };
  } catch (error) {
    // If the folder doesn't exist, create it
    if (error.code === 404) {
      const response = await drive.files.create({
        resource: {
          name: 'Converted Images',
          mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id, name'
      });
      
      return {
        id: response.data.id,
        name: response.data.name
      };
    }
    
    throw error;
  }
}

/**
 * Convert a PDF to a high-quality image using CloudConvert
 */
async function convertPdfToImage(cloudConvert, drive, pdfFile, imageFolder) {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmpDir = os.tmpdir();
    
    // Step 1: Download the PDF from Google Drive
    console.log(`Downloading ${pdfFile.name}...`);
    const tempPdfPath = path.join(tmpDir, pdfFile.name);
    await downloadFile(drive, pdfFile.id, tempPdfPath);
    
    // Step 2: Prepare the output file name
    const baseName = pdfFile.name.replace(/\.pdf$/i, '');
    const outputImageName = `${baseName}_image.png`;
    const outputImagePath = path.join(tmpDir, outputImageName);
    
    // Step 3: Convert PDF to image using CloudConvert
    console.log(`Converting ${pdfFile.name} to image...`);
    await convertWithCloudConvert(cloudConvert, tempPdfPath, outputImagePath);
    
    // Step 4: Upload the converted image to Google Drive
    console.log(`Uploading ${outputImageName} to Google Drive...`);
    const uploadedImage = await uploadFileToDrive(drive, outputImagePath, outputImageName, imageFolder.id);
    
    // Step 5: Clean up temporary files
    fs.unlinkSync(tempPdfPath);
    fs.unlinkSync(outputImagePath);
    
    console.log(`Converted ${pdfFile.name} to image: ${outputImageName}`);
    return uploadedImage;
  } catch (error) {
    console.error(`Error converting PDF to image ${pdfFile.name}:`, error);
    throw error;
  }
}

/**
 * Convert a PDF to an image using CloudConvert
 */
async function convertWithCloudConvert(cloudConvert, pdfPath, outputPath) {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Create conversion job
    const job = await cloudConvert.jobs.create({
      tasks: {
        'import-pdf': {
          operation: 'import/upload'
        },
        'convert-to-png': {
          operation: 'convert',
          input: 'import-pdf',
          output_format: 'png',
          engine: 'graphicsmagick',
          page_range: '1',  // Only first page
          density: 300,     // High quality
          quality: 100,     // Best quality
          flatten: true     // Flatten transparency
        },
        'export-png': {
          operation: 'export/url',
          input: 'convert-to-png'
        }
      }
    });
    
    // Upload the PDF
    const importTask = job.tasks.filter(task => task.name === 'import-pdf')[0];
    const inputFile = fs.createReadStream(pdfPath);
    
    await cloudConvert.tasks.upload(importTask, inputFile, path.basename(pdfPath));
    
    // Wait for the job to complete
    const jobResult = await cloudConvert.jobs.wait(job.id);
    
    // Get the export task
    const exportTask = jobResult.tasks.filter(task => task.name === 'export-png')[0];
    
    if (!exportTask || exportTask.status !== 'finished') {
      throw new Error('Export task did not complete successfully');
    }
    
    // Download the converted image
    const file = exportTask.result.files[0];
    const axios = require('axios');
    const writer = fs.createWriteStream(outputPath);
    
    const response = await axios({
      method: 'GET',
      url: file.url,
      responseType: 'stream'
    });
    
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('Error converting with CloudConvert:', error);
    throw error;
  }
}

/**
 * Download a file from Google Drive
 */
async function downloadFile(drive, fileId, destination) {
  try {
    const fs = require('fs');
    const {Readable} = require('stream');
    const {pipeline} = require('stream/promises');
    
    const response = await drive.files.get(
      {fileId, alt: 'media'},
      {responseType: 'stream'}
    );
    
    const writeStream = fs.createWriteStream(destination);
    await pipeline(response.data, writeStream);
  } catch (error) {
    console.error(`Error downloading file ${fileId}:`, error);
    throw error;
  }
}

/**
 * Upload a file to Google Drive
 */
async function uploadFileToDrive(drive, filePath, fileName, folderId) {
  try {
    const fs = require('fs');
    
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };
    
    const media = {
      mimeType: 'image/png',
      body: fs.createReadStream(filePath)
    };
    
    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink'
    });
    
    return {
      id: response.data.id,
      name: response.data.name,
      link: response.data.webViewLink
    };
  } catch (error) {
    console.error(`Error uploading file ${fileName}:`, error);
    throw error;
  }
}

/**
 * Extract text from an image using Google Cloud Vision API
 */
async function extractTextFromImage(vision, drive, image) {
  try {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpDir = os.tmpdir();
    
    // Download the image file
    const tempImagePath = path.join(tmpDir, image.name);
    await downloadFile(drive, image.id, tempImagePath);
    
    // Read the file into a buffer
    const imageBuffer = fs.readFileSync(tempImagePath);
    
    // Perform text detection on the image
    const [result] = await vision.textDetection(imageBuffer);
    const detections = result.textAnnotations;
    
    // Clean up the temporary file
    fs.unlinkSync(tempImagePath);
    
    // Extract the full text from the first annotation (if available)
    if (detections && detections.length > 0) {
      return detections[0].description;
    }
    
    return '';
  } catch (error) {
    console.error(`Error extracting text from image ${image.name}:`, error);
    throw error;
  }
}

/**
 * Parse data from extracted text
 * This function is adapted from your existing code but simplified for this script
 */
function parseDataFromText(text) {
  if (!text || text.trim().length === 0) {
    console.log("Empty text provided to parser");
    return [];
  }

  const items = [];
  
  // Check for specific vendor formats and use specialized parsers
  if (text.includes('RIPPLE JUNCTION') || text.includes('ZQBQ')) {
    return parseRippleJunctionPO(text);
  }
  
  if (text.includes('FA World Entertainment')) {
    return parseFAWorldPO(text);
  }
  
  if (text.includes('Violent Gentlemen')) {
    return parseViolentGentlemenPO(text);
  }
  
  // For Baker Boys Distribution
  if (text.includes('Baker Boys Distribution')) {
    return parseBakerBoysPO(text);
  }
  
  // Generic fallback parser
  return parseGenericPO(text);
}

/**
 * Parse Ripple Junction PO data
 */
function parseRippleJunctionPO(text) {
  const items = [];
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/(\d{6})\s+REVISION/);
  if (poMatch) {
    poNumber = poMatch[1];
  }
  
  // Extract items (simplified from your original code)
  const pattern = /ZQBQ\d+[A-Z]*\s+001\s+BLACK\s+\d+\s+GODZILLA[\s-]*CLASSIC[\s-]*KING[\s-]*OF[\s-]*MINI\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)/gi;
  
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const styleMatch = match[0].match(/ZQBQ\d+[A-Z]*/);
    if (!styleMatch) continue;
    
    const style = styleMatch[0];
    const qty = parseInt(match[1]);
    const unitPrice = parseFloat(match[2].replace(',', ''));
    const totalAmount = parseFloat(match[3].replace(',', ''));
    
    items.push({
      customer: 'Ripple Junction',
      po: poNumber,
      style: style,
      description: 'GODZILLA CLASSIC KING OF MINI BACKPACK',
      qty: qty,
      unit_price: unitPrice,
      total_amount: totalAmount
    });
  }
  
  return items;
}

/**
 * Parse FA World PO data
 */
function parseFAWorldPO(text) {
  const items = [];
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/PO\s+(\d+)/);
  if (poMatch) {
    poNumber = poMatch[1];
  }
  
  // Find Pile Fleece Overshirt
  const pileFleeceLine = text.match(/Pile Fleece Overshirt[\s\S]+?Black - Black[\s]+(\d+)[\s]+([\d,.]+\.\d+)/i);
  if (pileFleeceLine) {
    const qty = parseInt(pileFleeceLine[1]);
    const totalAmount = parseFloat(pileFleeceLine[2].replace(/,/g, ''));
    
    const unitPriceParts = text.match(/Pile Fleece Overshirt[\s\S]+?Xs[\s\n]+\d+[\s\n]+(\d+\.\d+)/i);
    const unitPrice = unitPriceParts ? parseFloat(unitPriceParts[1]) : (totalAmount / qty);
    
    items.push({
      customer: 'FA World Entertainment',
      po: poNumber,
      style: 'PILE-FLEECE-OVERSHIRT',
      description: 'PILE FLEECE OVERSHIRT (Black - Black)',
      qty: qty,
      unit_price: unitPrice,
      total_amount: totalAmount
    });
  }
  
  // Find Corduroy Lounge Pants
  const corduroyLine = text.match(/Corduroy Lounge Pants - Fall 25[\s\S]+?Brown - Brown[\s]+(\d+)[\s]+([\d,.]+\.\d+)/i);
  if (corduroyLine) {
    const qty = parseInt(corduroyLine[1]);
    const totalAmount = parseFloat(corduroyLine[2].replace(/,/g, ''));
    
    const unitPriceParts = text.match(/Corduroy Lounge Pants[\s\S]+?Xs[\s\n]+\d+[\s\n]+(\d+\.\d+)/i);
    const unitPrice = unitPriceParts ? parseFloat(unitPriceParts[1]) : (totalAmount / qty);
    
    items.push({
      customer: 'FA World Entertainment',
      po: poNumber,
      style: 'CORDUROY-LOUNGE-PANTS-FALL25',
      description: 'CORDUROY LOUNGE PANTS FALL25 (Brown - Brown)',
      qty: qty,
      unit_price: unitPrice,
      total_amount: totalAmount
    });
  }
  
  return items;
}

/**
 * Parse Violent Gentlemen PO data
 */
function parseViolentGentlemenPO(text) {
  const items = [];
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/Purchase Order#\s*([^\s]+)/);
  if (poMatch) {
    poNumber = poMatch[1];
  }
  
  // Extract items (simplified version)
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const standardItemRegex = /^([A-Za-z\s]+)\s+([A-Z0-9-]+)\s+([A-Za-z\s]+)\s+([A-Za-z\s]+)(\s+\d+){5,8}\s+(\d+)\s+\$([\d.]+)\s+\$([\d,.]+)(.*)/;
    const standardMatch = line.match(standardItemRegex);
    
    if (standardMatch) {
      const styleName = standardMatch[1].trim();
      const styleNumber = standardMatch[2].trim();
      const totalQty = parseInt(standardMatch[6]);
      const unitPrice = parseFloat(standardMatch[7]);
      const totalAmount = parseFloat(standardMatch[8].replace(',', ''));
      
      items.push({
        customer: 'Violent Gentlemen',
        po: poNumber,
        style: styleNumber,
        description: styleName,
        qty: totalQty,
        unit_price: unitPrice,
        total_amount: totalAmount
      });
      
      // Check for oversize data in the remaining text
      const remainingText = standardMatch[9].trim();
      const oversizeMatch = remainingText.match(/(\d+)\s+\d+\s+\$([\d.]+)\s+\$([\d,.]+)/);
      if (oversizeMatch) {
        const oversizeQty = parseInt(oversizeMatch[1]);
        const oversizePrice = parseFloat(oversizeMatch[2]);
        const oversizeTotal = parseFloat(oversizeMatch[3].replace(',', ''));
        
        items.push({
          customer: 'Violent Gentlemen',
          po: poNumber,
          style: `${styleNumber}-OVERSIZE`,
          description: `${styleName} - OVERSIZE`,
          qty: oversizeQty,
          unit_price: oversizePrice,
          total_amount: oversizeTotal
        });
      }
    }
  }
  
  return items;
}

/**
 * Parse Baker Boys Distribution PO data
 */
function parseBakerBoysPO(text) {
  const items = [];
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/P\.O\. Number:\s*([^\s]+)/);
  if (poMatch) {
    poNumber = poMatch[1];
  }
  
  // Extract items
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const styleMatch = line.match(/^([0-9-]+)\s+EACH\s+(\d+)\s+\d+\s+\d+\s+([\d.]+)\s+([\d,.]+)\s+(.+)/);
    if (styleMatch) {
      const [, itemCode, qty, unitPrice, totalAmount, description] = styleMatch;
      
      items.push({
        customer: 'Baker Boys Distribution',
        po: poNumber,
        style: itemCode,
        description: description.split('Whse:')[0].trim(),
        qty: parseInt(qty),
        unit_price: parseFloat(unitPrice),
        total_amount: parseFloat(totalAmount.replace(',', ''))
      });
    }
  }
  
  return items;
}

/**
 * Generic parser for other PO types
 */
function parseGenericPO(text) {
  // Extract customer name
  let customer = 'Unknown';
  
  // Try to extract from various formats
  const customerMatch = text.match(/Customer:\s*([^\n]+)/i) || 
                         text.match(/SOLD\s+TO:\s*([^\n]+)/i) ||
                         text.match(/BILL\s+TO:\s*([^\n]+)/i);
  
  if (customerMatch) {
    customer = customerMatch[1].trim();
  }
  
  // Extract PO number
  let poNumber = '';
  const poMatch = text.match(/P\.?O\.?\s*(?:Number|#)?\s*:?\s*([A-Z0-9\-]+)/i) ||
                    text.match(/Purchase\s+Order\s*(?:Number|#)?\s*:?\s*([A-Z0-9\-]+)/i);
  
  if (poMatch) {
    poNumber = poMatch[1].trim();
  }
  
  // Try to extract items using generic patterns
  const items = [];
  const lines = text.split('\n');
  
  // Look for lines with qty, unit price and total patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Match patterns with item number, quantity, unit price, and total
    const itemMatch = line.match(/([A-Z0-9\-]+)\s+.*?(\d+)\s+.*?\$([\d,.]+)\s+.*?\$([\d,.]+)/i);
    
    if (itemMatch) {
      const [, style, qty, unitPrice, totalAmount] = itemMatch;
      
      // Try to find a description in the next line or same line
      let description = '';
      if (i + 1 < lines.length && !lines[i + 1].match(/\$/)) {
        description = lines[i + 1].trim();
      } else {
        // Extract description from current line by removing the matched parts
        description = line.replace(style, '').replace(/\d+/, '').replace(/\$[\d,.]+/g, '').trim();
      }
      
      items.push({
        customer,
        po: poNumber,
        style,
        description,
        qty: parseInt(qty),
        unit_price: parseFloat(unitPrice.replace(',', '')),
        total_amount: parseFloat(totalAmount.replace(',', ''))
      });
    }
  }
  
  return items;
}

/**
 * Update the spreadsheet with the parsed data
 */
async function updateSpreadsheet(sheets, spreadsheetId, sheetIndex, parsedData, fileName) {
  try {
    if (!parsedData || parsedData.length === 0) {
      console.log(`No data to write for ${fileName}`);
      return;
    }
    
    // Get the SFWW PO# from the filename
    const poMatch = fileName.match(/SFWW PO# (\d+)/);
    const sfwwPoNumber = poMatch ? poMatch[1] : "Unknown";
    
    // Get the sheet metadata to find the next empty row
    const metaResponse = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false
    });
    
    const sheetId = metaResponse.data.sheets[sheetIndex].properties.sheetId;
    const sheetTitle = metaResponse.data.sheets[sheetIndex].properties.title;
    
    // Get the current data to find the last row
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetTitle}!A:A`
    });
    
    const rows = dataResponse.data.values || [];
    let nextRow = rows.length + 1;
    
    // If there's a header row, but no data, start at row 2
    if (rows.length === 1) {
      nextRow = 2;
    } else if (rows.length === 0) {
      // If sheet is completely empty, add a header row first
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetTitle}!A1:I1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            "SFWW PO#", "SFWW INVOICE#", "CUSTOMER", "CUSTOMER PO#", 
            "STYLE# or ITEM#", "DESCR or STYLE NAME", "TOTAL QTY ORDERED", 
            "UNIT PRICE", "TOTAL PO AMOUNT"
          ]]
        }
      });
      
      // Format the header row
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              updateCells: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 9
                },
                rows: [
                  {
                    values: Array(9).fill({
                      userEnteredFormat: {
                        backgroundColor: { red: 0, green: 0, blue: 0 },
                        textFormat: { 
                          foregroundColor: { red: 1, green: 1, blue: 0 },
                          bold: true
                        },
                        horizontalAlignment: 'CENTER',
                        wrapStrategy: 'WRAP'
                      }
                    })
                  }
                ],
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)'
              }
            }
          ]
        }
      });
      
      nextRow = 2;
    }
    
    // Prepare the values to insert
    const valuesToInsert = parsedData.map(item => [
      sfwwPoNumber,                   // A: SFWW PO#
      sfwwPoNumber,                   // B: SFWW INVOICE#
      item.customer || '',            // C: Customer
      item.po || '',                  // D: PO#
      item.style || '',               // E: Style#/Item#
      item.description || '',         // F: Description
      item.qty || '',                 // G: Total Qty
      item.unit_price || '',          // H: Unit Price
      item.total_amount || ''         // I: TOTAL PO AMOUNT
    ]);
    
    // Insert the values
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A${nextRow}:I${nextRow + valuesToInsert.length - 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: valuesToInsert
      }
    });
    
    // Calculate totals
    const totalQty = parsedData.reduce((sum, item) => sum + (item.qty || 0), 0);
    const totalAmount = parsedData.reduce((sum, item) => sum + (item.total_amount || 0), 0);
    
    // Insert the grand total row
    const totalRow = nextRow + valuesToInsert.length;
    
    // Update the grand total row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A${totalRow}:I${totalRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          '', '', '', '', '', 'GRAND TOTAL', totalQty, '', totalAmount
        ]]
      }
    });
    
    // Format the grand total row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            // Black background for the entire row
            updateCells: {
              range: {
                sheetId,
                startRowIndex: totalRow - 1,
                endRowIndex: totalRow,
                startColumnIndex: 0,
                endColumnIndex: 9
              },
              rows: [
                {
                  values: Array(9).fill({
                    userEnteredFormat: {
                      backgroundColor: { red: 0, green: 0, blue: 0 },
                      textFormat: { 
                        foregroundColor: { red: 1, green: 1, blue: 1 },
                      }
                    }
                  })
                }
              ],
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          },
          {
            // Right align the "GRAND TOTAL" text
            updateCells: {
              range: {
                sheetId,
                startRowIndex: totalRow - 1,
                endRowIndex: totalRow,
                startColumnIndex: 5,
                endColumnIndex: 6
              },
              rows: [
                {
                  values: [
                    {
                      userEnteredFormat: {
                        horizontalAlignment: 'RIGHT',
                      }
                    }
                  ]
                }
              ],
              fields: 'userEnteredFormat(horizontalAlignment)'
            }
          },
          {
            // Format the total amount column as currency
            updateCells: {
              range: {
                sheetId,
                startRowIndex: nextRow - 1,
                endRowIndex: totalRow,
                startColumnIndex: 7,
                endColumnIndex: 9
              },
              rows: Array(totalRow - nextRow + 1).fill({
                values: Array(2).fill({
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'CURRENCY',
                      pattern: '$#,##0.00'
                    }
                  }
                })
              }),
              fields: 'userEnteredFormat(numberFormat)'
            }
          },
          {
            // Center align all data in the table
            updateCells: {
              range: {
                sheetId,
                startRowIndex: nextRow - 1,
                endRowIndex: totalRow - 1,
                startColumnIndex: 0,
                endColumnIndex: 9
              },
              rows: Array(totalRow - nextRow).fill({
                values: Array(9).fill({
                  userEnteredFormat: {
                    horizontalAlignment: 'CENTER'
                  }
                })
              }),
              fields: 'userEnteredFormat(horizontalAlignment)'
            }
          }
        ]
      }
    });
    
    console.log(`Updated spreadsheet with ${parsedData.length} items from ${fileName}`);
    
    // Add empty rows between PO groups if this isn't the first group
    if (nextRow > 2) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex: totalRow,
                  endIndex: totalRow + 5
                },
                inheritFromBefore: false
              }
            }
          ]
        }
      });
    }
    
    return {
      rowsAdded: valuesToInsert.length + 1, // +1 for the grand total row
      totalItems: parsedData.length,
      totalQuantity: totalQty,
      totalAmount: totalAmount
    };
  } catch (error) {
    console.error(`Error updating spreadsheet for ${fileName}:`, error);
    throw error;
  }
}

/**
 * Command-line script to run the process
 */
async function runCommand() {
  try {
    // Get command line arguments
    const argv = require('yargs')
      .option('source', {
        alias: 's',
        description: 'Source folder ID containing PDFs',
        default: SOURCE_FOLDER_ID
      })
      .option('images', {
        alias: 'i',
        description: 'Destination folder ID for images',
        default: IMAGE_FOLDER_ID
      })
      .option('spreadsheet', {
        alias: 'ss',
        description: 'Target spreadsheet ID',
        default: TARGET_SPREADSHEET_ID
      })
      .option('tab', {
        alias: 't',
        description: 'Tab index in the spreadsheet (0-based)',
        default: TARGET_SHEET_TAB_INDEX
      })
      .option('prefix', {
        alias: 'p',
        description: 'File prefix to filter by (e.g., "SFWW PO# ")',
        default: 'SFWW PO# '
      })
      .help()
      .alias('help', 'h')
      .argv;
    
    // Override global constants with command line arguments
    SOURCE_FOLDER_ID = argv.source;
    IMAGE_FOLDER_ID = argv.images;
    TARGET_SPREADSHEET_ID = argv.spreadsheet;
    TARGET_SHEET_TAB_INDEX = argv.tab;
    
    // Run the main function
    const result = await main();
    console.log(JSON.stringify(result, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Export functions for testing or importing
module.exports = {
  main,
  getSecret,
  convertPdfToImage,
  extractTextFromImage,
  parseDataFromText,
  updateSpreadsheet
};

// Run the script if called directly
if (require.main === module) {
  runCommand();
}
>>>>>>> 6396c5ea6ee42878c2dba49cce030c9c78a7ab0f
