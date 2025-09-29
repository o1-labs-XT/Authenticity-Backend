export interface Column<T> {
  key: keyof T | 'actions';
  label: string;
  render?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  emptyMessage?: string;
}

export default function DataTable<T>({
  data,
  columns,
  emptyMessage = 'No data found',
}: DataTableProps<T>) {
  const getRowKey = (item: T, idx: number): string | number => {
    if (typeof item === 'object' && item !== null) {
      const obj = item as any;
      return obj.id || obj.walletAddress || idx;
    }
    return idx;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b">
          <tr>
            {columns.map((col) => (
              <th
                key={String(col.key)}
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-4 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item, idx) => (
              <tr key={getRowKey(item, idx)}>
                {columns.map((col) => (
                  <td key={String(col.key)} className="px-6 py-4 whitespace-nowrap text-sm">
                    {col.render
                      ? col.render(item)
                      : col.key !== 'actions'
                      ? String(item[col.key as keyof T] || '')
                      : null}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}