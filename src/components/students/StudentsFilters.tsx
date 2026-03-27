import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";

import { STUDENT_ROWS_PER_PAGE_OPTIONS, type StudentPaymentStatusFilter } from "@/api/students";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STUDENT_GENDER_OPTIONS, type StudentGenderFilter } from "@/lib/studentGender";

type StudentsFiltersProps = {
  gender: StudentGenderFilter;
  isFetching: boolean;
  onClearFilters: () => void;
  onGenderChange: (value: StudentGenderFilter) => void;
  onLimitChange: (value: number) => void;
  onPaymentStatusChange: (value: StudentPaymentStatusFilter) => void;
  onSearchChange: (value: string) => void;
  onSeatNumberChange: (value: string) => void;
  paymentStatus: StudentPaymentStatusFilter;
  rowsPerPage: number;
  searchValue: string;
  seatNumber: string;
  showClearFilters: boolean;
};

const StudentsFilters = ({
  gender,
  isFetching,
  onClearFilters,
  onGenderChange,
  onLimitChange,
  onPaymentStatusChange,
  onSearchChange,
  onSeatNumberChange,
  paymentStatus,
  rowsPerPage,
  searchValue,
  seatNumber,
  showClearFilters,
}: StudentsFiltersProps) => (
  <div className="rounded-3xl border border-border/70 bg-card/95 p-4 shadow-sm">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_220px_180px_180px]">
        <div className="space-y-2">
          <label htmlFor="student-search" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="student-search"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search by student name or phone"
              className="h-11 rounded-2xl border-border/70 bg-background pl-10"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Payment Status</label>
          <Select value={paymentStatus} onValueChange={(value) => onPaymentStatusChange(value as StudentPaymentStatusFilter)}>
            <SelectTrigger className="h-11 rounded-2xl border-border/70 bg-background">
              <SelectValue placeholder="All payment states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Paid">Paid</SelectItem>
              <SelectItem value="Unpaid">Unpaid</SelectItem>
              <SelectItem value="Overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label htmlFor="seat-filter" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Seat Number
          </label>
          <Input
            id="seat-filter"
            value={seatNumber}
            onChange={(event) => onSeatNumberChange(event.target.value)}
            placeholder="A-12"
            className="h-11 rounded-2xl border-border/70 bg-background"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Gender</label>
          <Select value={gender} onValueChange={(value) => onGenderChange(value as StudentGenderFilter)}>
            <SelectTrigger className="h-11 rounded-2xl border-border/70 bg-background">
              <SelectValue placeholder="All genders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All genders</SelectItem>
              {STUDENT_GENDER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rows Per Page</label>
          <Select value={String(rowsPerPage)} onValueChange={(value) => onLimitChange(Number(value))}>
            <SelectTrigger className="h-11 w-full min-w-[124px] rounded-2xl border-border/70 bg-background sm:w-[124px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STUDENT_ROWS_PER_PAGE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex h-11 items-center gap-2 rounded-2xl border border-dashed border-border/70 px-4 text-sm text-muted-foreground">
            <SlidersHorizontal className="h-4 w-4" />
            {isFetching ? "Refreshing results..." : "API-backed filters active"}
          </div>
          {showClearFilters ? (
            <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={onClearFilters}>
              <RotateCcw className="h-4 w-4" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  </div>
);

export default StudentsFilters;
