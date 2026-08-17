"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Mail } from "lucide-react";

export function AlertEmailsManager() {
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/alert-emails")
      .then((r) => r.json())
      .then((data) => {
        if (data.emails) setEmails(data.emails);
        setLoading(false);
      });
  }, []);

  async function addEmail() {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    const updated = [...emails, trimmed];
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/alert-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails: updated }),
    });
    if (res.ok) {
      setEmails(updated);
      setNewEmail("");
    } else {
      const { error } = await res.json();
      setError(error ?? "Failed to add email");
    }
    setSaving(false);
  }

  async function removeEmail(email: string) {
    const updated = emails.filter((e) => e !== email);
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/alert-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails: updated }),
    });
    if (res.ok) {
      setEmails(updated);
    } else {
      const { error } = await res.json();
      setError(error ?? "Failed to remove email");
    }
    setSaving(false);
  }

  return (
    <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
      <h2 className="mb-2 text-lg font-semibold text-on-surface">Staff Alert Emails</h2>
      <p className="mb-5 text-sm text-on-surface-variant">
        Manage email recipients who receive hot lead alerts. These will be activated once Brevo is configured.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/50" />
          <input
            type="email"
            placeholder="Add email address..."
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEmail()}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-low py-2.5 pl-10 pr-4 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
          />
        </div>
        <button
          onClick={addEmail}
          disabled={saving || !newEmail.trim()}
          className="flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5 text-sm font-semibold text-on-secondary transition hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-error-container/30 px-3 py-2 text-sm text-error">{error}</p>
      )}

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-on-surface-variant">Loading...</p>
        ) : emails.length > 0 ? (
          emails.map((email) => (
            <div key={email} className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2.5">
              <span className="text-sm text-on-surface">{email}</span>
              <button
                onClick={() => removeEmail(email)}
                disabled={saving}
                className="text-on-surface-variant transition hover:text-error disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        ) : (
          <p className="text-sm text-on-surface-variant">No alert emails configured yet.</p>
        )}
      </div>
    </div>
  );
}
