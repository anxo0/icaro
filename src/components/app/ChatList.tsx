import { useEffect } from 'react';
import IconPlus from '~icons/solar/pen-new-square-linear';
import IconTrash from '~icons/solar/trash-bin-minimalistic-linear';
import IconFile from '~icons/solar/document-text-linear';
import { fmt, type AppStrings, type Lang } from '@/i18n';
import { chatsStore, deleteChat, hydrateChats, openChat, type StoredChat } from '@/lib/chats';
import { useStore } from '@/lib/store';

interface Props {
  lang: Lang;
  t: AppStrings['list'];
}

function groupLabel(t: AppStrings['list'], ts: number, now: number): string {
  const day = 86_400_000;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return t.today;
  if (ts >= startOfToday - day) return t.yesterday;
  if (ts >= startOfToday - 7 * day) return t.week;
  return t.older;
}

/** Lista de chats guardados en localStorage. Vive en la barra lateral; comparte el store con la app. */
export default function ChatList({ lang, t }: Props) {
  const chats = useStore(chatsStore, (s) => s.chats);
  const activeId = useStore(chatsStore, (s) => s.activeId);
  const hydrated = useStore(chatsStore, (s) => s.hydrated);

  useEffect(() => {
    hydrateChats();
  }, []);

  const now = Date.now();
  const groups: { label: string; items: StoredChat[] }[] = [];
  for (const chat of chats) {
    const label = groupLabel(t, chat.updatedAt, now);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(chat);
    else groups.push({ label, items: [chat] });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        onClick={() => openChat(null)}
        className="mx-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
      >
        <IconPlus className="size-4.5 text-ink-2" />
        {t.new}
      </button>

      <nav aria-label={t.title} className="scrollbar-thin mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {hydrated && chats.length === 0 && <p className="px-3 py-2 text-xs text-ink-3">{t.empty}</p>}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="label px-3 pb-1">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((chat) => {
                const active = chat.id === activeId;
                return (
                  <li key={chat.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => openChat(chat.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex w-full items-center gap-2 rounded-lg py-2 pr-8 pl-3 text-left text-sm transition-colors ${
                        active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                      }`}
                    >
                      <IconFile className="size-4 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{chat.pdfName.replace(/\.pdf$/i, '')}</span>
                        <span className="block truncate text-[11px] text-ink-3">
                          {fmt(t.meta, { pages: chat.pages, n: chat.messages.filter((m) => m.role === 'user').length })}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteChat(chat.id)}
                      title={t.delete}
                      aria-label={`${t.delete}: ${chat.pdfName}`}
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-bad-soft hover:text-bad focus-visible:opacity-100"
                    >
                      <IconTrash className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <span hidden>{lang}</span>
    </div>
  );
}
