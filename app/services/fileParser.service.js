const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');

/**
 * Extracts plain text from an uploaded file buffer.
 *
 * Supported formats:
 *  - PDF  (.pdf)  → parsed via pdf-parse
 *  - DOCX (.docx) → parsed via mammoth
 *  - TXT  (.txt)  → decoded directly from buffer
 *
 * Returns extracted text as a string.
 */
const extractText = async (buffer, mimetype, originalname) => {
  const ext = originalname.split('.').pop().toLowerCase();

  if (ext === 'pdf' || mimetype === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (
    ext === 'docx' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === 'txt' || mimetype === 'text/plain') {
    return buffer.toString('utf-8');
  }

  throw new Error('Unsupported file type. Please upload a PDF, DOCX, or TXT file.');
};

module.exports = { extractText };
