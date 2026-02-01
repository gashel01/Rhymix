import { useState, useEffect, useRef } from 'react';
import { getAvailableFiles } from '../utils/apiService';

/**
 * Hook to fetch and manage available singing files
 * @returns {Object} - { availableFiles, rawVocals, loading, error, refetch }
 */
export const useAvailableFiles = () => {
  const [availableFiles, setAvailableFiles] = useState([]);
  const [rawVocals, setRawVocals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const hasFetchedRef = useRef(false);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await getAvailableFiles();

      if (response && response.files) {
        if (response.files.length > 0) {
          const normalized = response.files.map((file) => ({
            ...file,
            id: file.fileId,
            displayName: file.safeDisplayName || file.originalName,
            vocalUrl: file.vocalUrlProcessed || null,
            vocalPath: file.vocalPathProcessed || null,
            instrumentalUrl: file.instrumentalUrl || null,
            instrumentalPath: file.instrumentalPath || null,
          }));

          setAvailableFiles(normalized);

          const possibleRawVocals = response.files.map((file) => ({
            ...file,
            id: file.fileId,
            displayName: file.safeDisplayName || file.originalName,
            vocalUrl: file.vocalUrlRaw || null,
            vocalPath: file.vocalPathRaw || null,
            instrumentalUrl: file.instrumentalUrl || null,
            instrumentalPath: file.instrumentalPath || null,
          }));

          setRawVocals(possibleRawVocals);
        } else {
          setAvailableFiles([]);
          setRawVocals([]);
        }
      } else {
        console.warn('Unexpected API response format:', response);
        setAvailableFiles([]);
        setRawVocals([]);
      }
    } catch (err) {
      console.error('Failed to fetch available singing files:', err);
      setError(err.message);
      setAvailableFiles([]);
      setRawVocals([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only fetch once, even if component re-renders
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchFiles();
    }
  }, []);

  return {
    availableFiles,
    rawVocals,
    loading,
    error,
    refetch: fetchFiles,
  };
};
