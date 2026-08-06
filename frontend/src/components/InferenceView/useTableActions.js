import { useState, useCallback } from 'react';

export const useTableActions = ({ inferenceResults, trackPairs }) => {
  const [selectedRows, setSelectedRows] = useState([]);

  const handleRowSelect = useCallback((resultId, isSelected) => {
    if (isSelected) setSelectedRows((prev) => [...prev, resultId]);
    else setSelectedRows((prev) => prev.filter((id) => id !== resultId));
  }, []);

  const rows = trackPairs && trackPairs.length ? trackPairs : inferenceResults;
  const handleSelectAllRows = useCallback(() => setSelectedRows(rows.map((x) => x.id)), [rows]);
  const handleDeselectAllRows = useCallback(() => setSelectedRows([]), []);



    return {

        handleRowSelect,
        handleSelectAllRows,
        handleDeselectAllRows,
        selectedRows,
    };
};
