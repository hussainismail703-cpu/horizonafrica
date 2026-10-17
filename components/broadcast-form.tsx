"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BroadcastGroup, BroadcastContact } from "@/lib/types";
import { Send, Loader2, CheckCircle2, XCircle, Plus, Trash2, RefreshCw, Info, Upload, Download, Store } from "lucide-react";

interface BroadcastFormProps {
  groups: BroadcastGroup[];
}

interface TemplateParameter {
  position: number;
  label: string;
  component: string;
}

interface Template {
  name: string;
  label: string;
  status: string;
  category: string;
  language?: string;
  parameters?: TemplateParameter[];
  body_text?: string | null;
}

interface ParamConfig {
  source: "contact_name" | "custom";
  value: string;
  component: string;
}

const FALLBACK_TEMPLATES: Template[] = [
  { name: "hello_world", label: "Hello World (Test)", status: "approved", category: "MARKETING" },
];

interface SendResult {
  broadcast_id: number;
  total_recipients: number;
  sent: number;
  failed: number;
  errors?: string[];
}

export function BroadcastForm({ groups }: BroadcastFormProps) {
  const [groupId, setGroupId] = useState<string>("");
  const [templates, setTemplates] = useState<Template[]>(FALLBACK_TEMPLATES);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [template, setTemplate] = useState<string>("hello_world");
  const [campaignName, setCampaignName] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paramConfigs, setParamConfigs] = useState<ParamConfig[]>([]);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/broadcasts/templates");
      if (res.ok) {
        const data = await res.json();
        if (data.templates && data.templates.length > 0) {
          const approved = data.templates.filter((t: Template) => t.status === "approved");
          const list = approved.length > 0 ? approved : data.templates;
          setTemplates(list);
          if (!list.some((t: Template) => t.name === template)) {
            setTemplate(list[0].name);
          }
        }
      }
    } catch {
      // Keep fallback templates on error
    }
    setTemplatesLoading(false);
  }, [template]);

  useEffect(() => {
    fetchTemplates();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTemplate = templates.find((t) => t.name === template);
  const isTestMode = testPhone.trim().length > 0;
  const templateParams = selectedTemplate?.parameters ?? [];
  const hasParams = templateParams.length > 0;

  // Reset param configs when template changes
  useEffect(() => {
    if (templateParams.length > 0) {
      setParamConfigs(templateParams.map((p, i) => ({
        source: i === 0 ? "contact_name" : "custom",
        value: "",
        component: p.component,
      })));
    } else {
      setParamConfigs([]);
    }
  }, [template]); // eslint-disable-line react-hooks/exhaustive-deps

  // For test mode, all params must be custom (no contact to auto-fill from)
  const effectiveParamConfigs = isTestMode
    ? paramConfigs.map((p) => ({ ...p, source: "custom" as const }))
    : paramConfigs;

  const allParamsFilled = !hasParams || effectiveParamConfigs.every(
    (p) => p.source === "contact_name" || p.value.trim().length > 0
  );
  const canSend = (isTestMode || groupId) && !sending && allParamsFilled;

  // Build live preview text
  const previewText = (() => {
    if (!selectedTemplate?.body_text) return null;
    let text = selectedTemplate.body_text;
    effectiveParamConfigs.forEach((p, i) => {
      const placeholder = `{{${i + 1}}}`;
      const value = p.source === "contact_name"
        ? (isTestMode ? "[Contact Name]" : "John")
        : (p.value.trim() || `[Parameter ${i + 1}]`);
      text = text.replace(placeholder, value);
    });
    return text;
  })();

  async function sendBroadcast() {
    setSending(true);
    setError(null);
    setResult(null);

    try {
      const payload: Record<string, unknown> = {
        template_name: template,
        campaign_name: campaignName || undefined,
      };

      if (selectedTemplate?.language) {
        payload.template_language = selectedTemplate.language;
      }

      if (isTestMode) {
        payload.test_phone = testPhone.trim();
      } else {
        payload.group_id = Number(groupId);
      }

      if (hasParams) {
        payload.template_parameters = effectiveParamConfigs.map((p) => ({
          source: p.source,
          value: p.value.trim(),
          component: p.component,
        }));
      }

      const res = await fetch("/api/broadcasts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to send broadcast");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error sending broadcast");
    }

    setSending(false);
  }

  return (
    <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
      <h2 className="mb-5 text-lg font-semibold text-on-surface">New Broadcast</h2>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Campaign Name</label>
          <input
            type="text"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="e.g. July Welcome Campaign"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Template</label>
            <button
              type="button"
              onClick={fetchTemplates}
              disabled={templatesLoading}
              className="flex items-center gap-1 text-xs text-on-surface-variant transition hover:text-on-surface disabled:opacity-50"
              title="Refresh templates"
            >
              <RefreshCw className={`h-3 w-3 ${templatesLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            disabled={templatesLoading}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none disabled:opacity-50"
          >
            {templatesLoading && (
              <option value="">Loading templates...</option>
            )}
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.label} — {t.category}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Test Phone (optional)</label>
          <input
            type="tel"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+27658475289"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
          />
          <p className="mt-1 text-xs text-on-surface-variant">
            Enter a phone number to send a single test message. Leave empty to send to a group.
          </p>
        </div>

        {!isTestMode && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Select Group</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm focus:border-secondary focus:outline-none"
            >
              <option value="">Choose a group...</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.group_label} — {g.group_name}</option>
              ))}
            </select>
          </div>
        )}

        {hasParams && (
          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4">
            <div className="mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-secondary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Template Parameters ({templateParams.length})
              </span>
            </div>
            <div className="space-y-3">
              {templateParams.map((param, i) => (
                <div key={param.position} className="space-y-1.5">
                  <label className="block text-xs font-medium text-on-surface-variant">
                    {param.label}
                  </label>
                  {!isTestMode && (
                    <div className="flex gap-2">
                      <select
                        value={paramConfigs[i]?.source ?? "contact_name"}
                        onChange={(e) => {
                          const newConfigs = [...paramConfigs];
                          newConfigs[i] = {
                            ...newConfigs[i],
                            source: e.target.value as "contact_name" | "custom",
                          };
                          setParamConfigs(newConfigs);
                        }}
                        className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-2 text-xs focus:border-secondary focus:outline-none"
                      >
                        <option value="contact_name">Contact Name (auto)</option>
                        <option value="custom">Same for everyone</option>
                      </select>
                      {paramConfigs[i]?.source === "custom" && (
                        <input
                          type="text"
                          value={paramConfigs[i]?.value ?? ""}
                          onChange={(e) => {
                            const newConfigs = [...paramConfigs];
                            newConfigs[i] = {
                              ...newConfigs[i],
                              value: e.target.value,
                            };
                            setParamConfigs(newConfigs);
                          }}
                          placeholder={`Enter value for ${param.label}`}
                          className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
                        />
                      )}
                    </div>
                  )}
                  {isTestMode && (
                    <input
                      type="text"
                      value={paramConfigs[i]?.value ?? ""}
                      onChange={(e) => {
                        const newConfigs = [...paramConfigs];
                        newConfigs[i] = {
                          source: "custom",
                          value: e.target.value,
                          component: paramConfigs[i]?.component ?? "body",
                        };
                        setParamConfigs(newConfigs);
                      }}
                      placeholder={`Enter value for ${param.label}`}
                      className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/10"
                    />
                  )}
                </div>
              ))}
            </div>

            {previewText && (
              <div className="mt-3 rounded-lg bg-surface-container-high p-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">Preview</p>
                <p className="text-xs text-on-surface whitespace-pre-wrap">{previewText}</p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-error-container/30 px-4 py-3 text-sm text-error">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="rounded-lg bg-secondary-container/20 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 text-secondary">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-semibold">Broadcast Complete</span>
            </div>
            <div className="mt-2 space-y-1 text-on-surface-variant">
              <p>Sent: {result.sent} / {result.total_recipients}</p>
              {result.failed > 0 && <p className="text-error">Failed: {result.failed}</p>}
              {result.errors && result.errors.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs text-error">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <button
          onClick={sendBroadcast}
          disabled={!canSend}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-on-primary shadow-lg transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              {isTestMode ? "Send Test Message" : "Send Broadcast"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

interface ContactsManagerProps {
  groups: BroadcastGroup[];
  contacts: BroadcastContact[];
}

export function ContactsManager({ groups, contacts: initialContacts }: ContactsManagerProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newGroup, setNewGroup] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState(initialContacts);
  const [uploadGroup, setUploadGroup] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addContact() {
    if (!newPhone || !newGroup) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/broadcasts/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_name: newName || null,
        phone_number: newPhone,
        group_id: Number(newGroup),
      }),
    });
    if (res.ok) {
      const { contact } = await res.json();
      setContacts([...contacts, contact]);
      setShowAdd(false);
      setNewName("");
      setNewPhone("");
      setNewGroup("");
    } else {
      const { error } = await res.json();
      setError(error ?? "Failed to add contact");
    }
    setSaving(false);
  }

  async function deleteContact(id: string) {
    const res = await fetch(`/api/broadcasts/contacts/${id}`, { method: "DELETE" });
    if (res.ok) {
      setContacts(contacts.filter((c) => String(c.id) !== id));
      toast.success("Contact deleted");
    } else {
      toast.error("Failed to delete contact");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadGroup) return;

    setUploading(true);
    setError(null);

    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

      const parsed = rows.map((row) => {
        const name = String(row["Contact Name"] ?? row["contact_name"] ?? row["Name"] ?? row["name"] ?? "").trim();
        const phone = String(row["Phone Number"] ?? row["phone_number"] ?? row["Phone"] ?? row["phone"] ?? "").trim();
        return { contact_name: name || null, phone_number: phone };
      }).filter((r) => r.phone_number.length > 0);

      if (parsed.length === 0) {
        setError("No valid rows found. Make sure your Excel has 'Contact Name' and 'Phone Number' columns.");
        setUploading(false);
        return;
      }

      const res = await fetch("/api/broadcasts/contacts/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: Number(uploadGroup), contacts: parsed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to import contacts");
        toast.error(data.error ?? "Failed to import contacts");
      } else {
        setContacts([...data.contacts, ...contacts]);
        setShowUpload(false);
        toast.success(`Imported ${data.imported} contacts${data.skipped > 0 ? `, ${data.skipped} skipped` : ""}`);
      }
    } catch {
      setError("Failed to read Excel file. Please ensure it's a valid .xlsx or .csv file.");
      toast.error("Failed to read Excel file");
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function downloadTemplate() {
    window.open("/api/broadcasts/contacts/template", "_blank");
  }

  async function syncShopify() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/broadcasts/sync-shopify", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Shopify sync failed");
        toast.error(data.error ?? "Shopify sync failed");
      } else {
        toast.success(
          `Synced ${data.customers_synced} Shopify customers — ${data.contacts_created} added, ${data.contacts_updated} updated` +
            (data.opted_out_excluded ? `, ${data.opted_out_excluded} opted out` : "")
        );
        router.refresh();
      }
    } catch {
      setError("Network error syncing Shopify customers");
      toast.error("Network error syncing Shopify customers");
    }
    setSyncing(false);
  }

  return (
    <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-on-surface">Contacts</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={syncShopify}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-1.5 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high disabled:opacity-50"
            title="Import customers from the Shopify store into the Eastern Wear Customers group"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
            {syncing ? "Syncing..." : "Sync Shopify"}
          </button>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-1.5 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high"
            title="Download Excel template"
          >
            <Download className="h-4 w-4" />
            Template
          </button>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-1.5 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high"
          >
            <Upload className="h-4 w-4" />
            Import
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-1.5 text-sm font-semibold text-on-secondary transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add Contact
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-low p-3 sm:flex-row">
          <input
            type="text"
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-secondary focus:outline-none"
          />
          <input
            type="text"
            placeholder="Phone (+27...)"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-secondary focus:outline-none"
          />
          <select
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-secondary focus:outline-none"
          >
            <option value="">Select group...</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.group_label}</option>
            ))}
          </select>
          <button
            onClick={addContact}
            disabled={saving || !newPhone || !newGroup}
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-on-secondary transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}

      {showUpload && (
        <div className="mb-4 space-y-3 rounded-lg border border-outline-variant bg-surface-container-low p-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Select Group</label>
            <select
              value={uploadGroup}
              onChange={(e) => setUploadGroup(e.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-secondary focus:outline-none"
            >
              <option value="">Choose a group...</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.group_label}</option>
              ))}
            </select>
          </div>
          <div
            onClick={() => uploadGroup && fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition ${uploadGroup ? "cursor-pointer border-outline-variant hover:border-secondary hover:bg-surface-container-lowest" : "cursor-not-allowed border-outline-variant/50 opacity-50"}`}
          >
            {uploading ? (
              <>
                <Loader2 className="mb-2 h-6 w-6 animate-spin text-secondary" />
                <p className="text-sm text-on-surface-variant">Importing contacts...</p>
              </>
            ) : (
              <>
                <Upload className="mb-2 h-6 w-6 text-on-surface-variant" />
                <p className="text-sm font-medium text-on-surface">Click to upload Excel file</p>
                <p className="mt-1 text-xs text-on-surface-variant">.xlsx or .csv format</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="hidden"
          />
          <div className="flex items-center justify-between text-xs">
            <p className="text-on-surface-variant">
              Need the correct format? Download the template first.
            </p>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1 font-semibold text-secondary transition hover:opacity-80"
            >
              <Download className="h-3 w-3" />
              Download Template
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mb-3 rounded-lg bg-error-container/30 px-3 py-2 text-sm text-error">{error}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              <th className="pb-2">Name</th>
              <th className="pb-2">Phone</th>
              <th className="pb-2">Group</th>
              <th className="pb-2">Opt-in</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {contacts.length > 0 ? (
              contacts.map((c) => {
                const group = groups.find((g) => g.id === c.group_id);
                return (
                  <tr key={c.id} className="border-b border-outline-variant/30 last:border-0">
                    <td className="py-2.5 text-on-surface">{c.contact_name ?? "—"}</td>
                    <td className="py-2.5 text-on-surface-variant">{c.phone_number}</td>
                    <td className="py-2.5 text-on-surface-variant">{group?.group_label ?? "—"}</td>
                    <td className="py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${c.opt_in ? "bg-secondary-container/30 text-secondary" : "bg-surface-container-high text-on-surface-variant"}`}>
                        {c.opt_in ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <button onClick={() => deleteContact(String(c.id))} className="text-on-surface-variant hover:text-error">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="py-8 text-center text-on-surface-variant">
                  No contacts added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
