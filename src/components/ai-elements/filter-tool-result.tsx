"use client";

import { FilterToolResultItem } from "@/app/api/chat/filter-tool";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
} from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import {
  AtSignIcon,
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  MailIcon,
  QuoteIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";

type FilterToolInput = {
  from?: string;
  to?: string;
  contains?: string;
  before?: string;
  after?: string;
  limit?: number;
};

type FilterToolOutput = {
  emails: FilterToolResultItem[];
};

type ActiveFilter = {
  label: string;
  value: string;
  Icon: LucideIcon;
};

export type FilterToolResultProps = {
  part: ToolUIPart;
  className?: string;
};

export const FilterToolResult = ({
  part,
  className,
}: FilterToolResultProps) => {
  const isOutputAvailable = part.state === "output-available";
  const input = (part.input ?? {}) as FilterToolInput;
  const output = part.output as FilterToolOutput | undefined;
  const emails = output?.emails ?? [];
  const activeFilters = buildActiveFilters(input);

  return (
    <Tool className={cn("mb-4", className)}>
      <ToolHeader title="Filter Emails" type={part.type} state={part.state} />
      <ToolContent>
        <ToolInput input={part.input} />

        {isOutputAvailable && (
          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {activeFilters.length === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    No filters applied
                  </span>
                ) : (
                  activeFilters.map((filter) => (
                    <Badge
                      key={filter.label}
                      variant="secondary"
                      className="gap-1 font-normal text-xs"
                    >
                      <filter.Icon className="h-3 w-3" />
                      <span className="text-muted-foreground">
                        {filter.label}:
                      </span>
                      <span className="max-w-[18ch] truncate">
                        {filter.value}
                      </span>
                    </Badge>
                  ))
                )}
              </div>
              <Badge variant="outline" className="shrink-0 text-xs">
                {emails.length} email{emails.length !== 1 ? "s" : ""}
              </Badge>
            </div>

            {emails.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No emails matched these filters.
              </p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {emails.map((email) => (
                  <EmailRow key={email.id} email={email} />
                ))}
              </div>
            )}
          </div>
        )}
      </ToolContent>
    </Tool>
  );
};

function buildActiveFilters(input: FilterToolInput): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (input.from)
    filters.push({ label: "From", value: input.from, Icon: UserIcon });
  if (input.to)
    filters.push({ label: "To", value: input.to, Icon: AtSignIcon });
  if (input.contains)
    filters.push({
      label: "Contains",
      value: input.contains,
      Icon: QuoteIcon,
    });
  if (input.after)
    filters.push({
      label: "After",
      value: formatDate(input.after),
      Icon: CalendarArrowUpIcon,
    });
  if (input.before)
    filters.push({
      label: "Before",
      value: formatDate(input.before),
      Icon: CalendarArrowDownIcon,
    });
  return filters;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function EmailRow({ email }: { email: FilterToolResultItem }) {
  const recipients = Array.isArray(email.to) ? email.to.join(", ") : email.to;

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm transition-colors hover:bg-accent/40">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <MailIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-medium text-sm">{email.subject}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground text-xs">
            <span className="truncate">
              <span className="font-medium">From:</span> {email.from}
            </span>
            <span className="truncate">
              <span className="font-medium">To:</span> {recipients}
            </span>
            <span className="truncate">
              <span className="font-medium">Date:</span>{" "}
              {formatDate(email.timestamp)}
            </span>
          </div>
          <p className="line-clamp-2 text-muted-foreground text-xs">
            {email.snippet}
          </p>
        </div>
      </div>
    </div>
  );
}
