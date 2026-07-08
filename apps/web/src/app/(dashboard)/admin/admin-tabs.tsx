'use client';

import { useState } from 'react';

export type AdminTab = { id: string; label: string; content: React.ReactNode };

/**
 * Tab ngang cho Admin Panel — mỗi tab là 1 mảng nội dung server-render truyền vào.
 * Giữ tất cả trong DOM (ẩn bằng `hidden`) để không mất trạng thái khi đổi tab.
 */
export function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`shrink-0 border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
              active === t.id
                ? 'border-indigo-400 text-white'
                : 'border-transparent text-white/45 hover:text-white/75'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tabs.map((t) => (
        <div key={t.id} className={active === t.id ? '' : 'hidden'}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
