/**
 * File utility functions for path manipulation and type detection
 */

/**
 * Extract filename from a file path
 * @param {string} filePath - Full file path
 * @returns {string} - Just the filename
 */
export const extractFilename = (filePath) => {
  if (!filePath) return null;
  return filePath.split(/[/\\]/).pop();
};

/**
 * Determine file type from filename
 * @param {string} filename - Filename to analyze
 * @param {string} vocalMode - Current vocal mode ('raw' or 'processed')
 * @returns {string} - File type ('instrumental', 'raw_vocals', 'processed_vocals', etc.)
 */
export const getFileType = (filename, vocalMode = 'processed') => {
  if (!filename) return null;
  
  if (filename.includes('_instrumental')) {
    return 'instrumental';
  } else if (filename.includes('_vocals')) {
    return vocalMode === 'raw' ? 'raw_vocals' : 'processed_vocals';
  }
  
  return null;
};

/**
 * Format filename for download with vocal type label
 * @param {string} filename - Original filename
 * @param {string} vocalMode - Current vocal mode ('raw' or 'processed')
 * @returns {string} - Formatted filename
 */
export const formatDownloadFilename = (filename, vocalMode = 'processed') => {
  if (!filename || !filename.includes('_vocals')) {
    return filename;
  }
  
  const fileNameParts = filename.split('.');
  const extension = fileNameParts.pop();
  const baseName = fileNameParts.join('.');
  const vocalTypeLabel = vocalMode === 'raw' ? '_RAW' : '_PROCESSED';
  
  return `${baseName}${vocalTypeLabel}.${extension}`;
};

/**
 * Extract base name from a vocal or instrumental filename
 * @param {string} filename - Filename with _vocals or _instrumental suffix
 * @returns {string} - Base name without suffix
 */
export const getBaseName = (filename) => {
  if (!filename) return null;
  return filename.replace(/_vocals\.wav$|_instrumental\.wav$/i, '');
};
