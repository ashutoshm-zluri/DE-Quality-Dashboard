import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PAGE_SIZE_OPTIONS } from "../api/pagination";

interface Props {
  /** Total number of (filtered) items being paginated. */
  total: number;
  /** 1-indexed current page. */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Optional label for the row count, e.g. "failures", "docs". */
  itemLabel?: string;
}

export default function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel = "items",
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 bg-ink-50/40 px-3 py-2 text-[12px]">
      <div className="text-ink-500">
        {total === 0 ? (
          <span>No {itemLabel}.</span>
        ) : (
          <>
            <span className="font-medium text-ink-700">
              {start.toLocaleString()}–{end.toLocaleString()}
            </span>{" "}
            of <span className="font-medium text-ink-700">{total.toLocaleString()}</span>{" "}
            {itemLabel}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <select
          className="input h-7 w-auto py-0 text-[12px]"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="Page size"
        >
          {PAGE_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s} / page
            </option>
          ))}
        </select>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onPageChange(1)}
            disabled={safePage <= 1}
            className="btn h-7 px-1.5 py-0"
            aria-label="First page"
            title="First page"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage <= 1}
            className="btn h-7 px-1.5 py-0"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="px-2 text-ink-700">
            {safePage} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages}
            className="btn h-7 px-1.5 py-0"
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={safePage >= totalPages}
            className="btn h-7 px-1.5 py-0"
            aria-label="Last page"
            title="Last page"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
