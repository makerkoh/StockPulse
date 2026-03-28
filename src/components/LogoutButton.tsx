"use client";

export default function LogoutButton() {
  return (
    <button
      className="flex items-center gap-2 text-xs text-text-tertiary hover:text-negative transition-colors"
      onClick={async () => {
        await fetch("/api/auth", { method: "DELETE" });
        window.location.href = "/login";
      }}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
      </svg>
      Log out
    </button>
  );
}
