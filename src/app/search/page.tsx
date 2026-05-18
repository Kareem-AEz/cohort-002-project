import { SideBar } from "@/components/side-bar";
import { TopBar } from "@/components/top-bar";
import { loadChats, loadMemories } from "@/lib/persistence-layer";
import { CHAT_LIMIT } from "../page";
import {
  emailToChunks,
  loadEmails,
  searchWithEmbeddings,
  searchWithRRF,
} from "../search";
import { EmailList } from "./email-list";
import { PerPageSelector } from "./per-page-selector";
import { SearchInput } from "./search-input";
import { SearchPagination } from "./search-pagination";

export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string; page?: string; perPage?: string }>;
}) {
  const searchParams = await props.searchParams;
  const query = searchParams.q || "";
  const page = Number(searchParams.page) || 1;
  const perPage = Number(searchParams.perPage) || 10;

  const allEmails = await loadEmails();
  const emailChunks = await emailToChunks(allEmails);

  const emailsWithScores = await searchWithRRF(query, emailChunks);

  // Transform emails to match the expected format
  // src/app/search/page.tsx

  const transformedEmails = emailsWithScores
    .map(({ item: emailChunk, score }) => ({
      id: emailChunk.id,
      from: emailChunk.from,
      subject: emailChunk.subject,
      preview: emailChunk.chunk.substring(0, 100) + "...",
      content: emailChunk.chunk,
      index: emailChunk.index,
      totalChunks: emailChunk.totalChunks,
      date: emailChunk.timestamp,
      score: score,
    }))
    .sort((a, b) => b.score - a.score);

  // Filter emails based on search query
  const filteredEmails = query
    ? transformedEmails.filter((email) => email.score > 0)
    : transformedEmails;

  const totalPages = Math.ceil(filteredEmails.length / perPage);
  const startIndex = (page - 1) * perPage;
  const paginatedEmails = filteredEmails.slice(
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
                Search through your email archive
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
                      Found {filteredEmails.length} result
                      {filteredEmails.length !== 1 ? "s" : ""} for &ldquo;
                      {query}
                      &rdquo;
                    </>
                  ) : (
                    <>Found {filteredEmails.length} emails</>
                  )}
                </p>
              </div>
              <EmailList emails={paginatedEmails} />
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
