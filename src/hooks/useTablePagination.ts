import { useState, useEffect, useCallback } from "react";

export function useTablePagination(tableName: string, initialPageSize = 25) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => {
    const saved = localStorage.getItem(`${tableName}-pagination`);
    if (saved) {
      const { pageSize: savedPageSize } = JSON.parse(saved);
      setPageSize(savedPageSize || initialPageSize);
    }
  }, [tableName, initialPageSize]);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
    localStorage.setItem(`${tableName}-pagination`, JSON.stringify({ pageSize: newSize }));
  }, [tableName]);

  const resetPage = useCallback(() => {
    setCurrentPage(1);
  }, []);

  return {
    currentPage,
    pageSize,
    setCurrentPage,
    handlePageSizeChange,
    resetPage,
  };
}
