import { TopBar } from "@/components/top-bar";
import { SearchInput } from "./search-input";
import { ChunkList } from "./chunk-list";
import { SearchPagination } from "./search-pagination";
import { PerPageSelector } from "./per-page-selector";

import { loadChats, loadMemories } from "@/lib/persistence-layer";
import { CHAT_LIMIT } from "../page";
import { SideBar } from "@/components/side-bar";
import { loadChunks } from "@/lib/utils";

export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string; page?: string; perPage?: string }>;
}) {
  const searchParams = await props.searchParams;
  const query = searchParams.q || "";
  const page = Number(searchParams.page) || 1;
  const perPage = Number(searchParams.perPage) || 10;

  const allChunks = await loadChunks();

  const normalizedQuery = query.toLowerCase().trim();

  const filteredChunks = normalizedQuery
    ? allChunks.filter((chunk) => {
        const haystack = [
          chunk.title,
          chunk.content,
          chunk.folder,
          chunk.sourcePath,
          ...chunk.tags,
          ...chunk.aliases,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : allChunks;

  const totalPages = Math.ceil(filteredChunks.length / perPage);
  const startIndex = (page - 1) * perPage;
  const paginatedChunks = filteredChunks.slice(
    startIndex,
    startIndex + perPage
  );

  const allChats = await loadChats();
  const chats = allChats.slice(0, CHAT_LIMIT);
  const memories = await loadMemories();

  return (
    <>
      <SideBar chats={chats} memories={memories} chatIdFromSearchParams={""} />
      <div className="h-screen flex flex-col w-full">
        <TopBar showSidebar={true} title="Data" />
        <div className="flex-1">
          <div className="max-w-4xl mx-auto xl:px-2 px-6 py-6">
            <div className="mb-6">
              <p className="text-sm text-muted-foreground">
                Search through your knowledge base
              </p>
            </div>

            <div className="flex md:items-center md:justify-between gap-4 flex-col md:flex-row">
              <SearchInput initialQuery={query} currentPerPage={perPage} />
              <PerPageSelector currentPerPage={perPage} query={query} />
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">
                  {query ? (
                    <>
                      Found {filteredChunks.length} result
                      {filteredChunks.length !== 1 ? "s" : ""} for &ldquo;
                      {query}
                      &rdquo;
                    </>
                  ) : (
                    <>Found {filteredChunks.length} entries</>
                  )}
                </p>
              </div>
              <ChunkList chunks={paginatedChunks} />
              {totalPages > 1 && (
                <div className="mt-6">
                  <SearchPagination
                    currentPage={page}
                    totalPages={totalPages}
                    query={query}
                    perPage={perPage}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
