import React, { useEffect, useMemo, useRef, useState } from "react";
import OmnicoreLogo from "./assets/OMNICORE.png";
const saved = sessionStorage.getItem('gh-spa-path');
if (saved) {
  sessionStorage.removeItem('gh-spa-path');
  history.replaceState(null, '', saved);
}
/* =========================
   Types
========================= */
type Defaults = {
  dhcpServerName: string;
  interface: string;
  networkCidr: string;
  gateway: string;
  dnsServers: string;
  leaseTime: string;
  authoritative: boolean;
  addArpForLeases: boolean;
};

type Row = {
  id: string;
  hostname: string;
  mac: string;
  ip: string;
  comment?: string;
  errors?: {
    mac?: string;
    ip?: string;
    hostname?: string;
  };
};

type UIMode = "terminal-green" | "terminal-amber" | "light";

/* =========================
   Feature flags
========================= */
const ALLOW_EXPORT = false; // flip when you want Copy/Download shown

/* =========================
   Validation helpers
========================= */
const isIPv4 = (ip: string) => {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
};

const isCidr = (cidr: string) => {
  const m = cidr.trim().match(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/);
  if (!m) return false;
  const [ip, maskStr] = cidr.split("/");
  const mask = Number(maskStr);
  if (mask < 0 || mask > 32) return false;
  return isIPv4(ip);
};

const isMac = (mac: string) => /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac.trim());

const commaListIPsOrHostnames = (input: string) => {
  if (!input.trim()) return false;
  return input.split(",").every((item) => {
    const s = item.trim();
    if (!s) return false;
    return isIPv4(s) || /^[a-zA-Z0-9.-]+$/.test(s);
  });
};

/* =========================
   Local storage helpers
========================= */
function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);

  return [value, setValue] as const;
}

/* =========================
   MikroTik generator
========================= */
function escapeComment(s: string) {
  return (s || "").replace(/"/g, "'");
}

function generateMikroTikScript(defs: Defaults, rows: Row[]): string {
  const ts = new Date().toISOString();
  const dnsServers = defs.dnsServers
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");

  const lines: string[] = [];
  lines.push(`# Omnicore Lease Builder`);
  lines.push(`# Generated: ${ts}`);
  lines.push(`# DHCP Server: ${defs.dhcpServerName}`);
  lines.push("");

  // Authoritative / add-arp toggles
  lines.push(`/ip dhcp-server set [ find name="${defs.dhcpServerName}" ] authoritative=${defs.authoritative ? "yes" : "no"}`);
  lines.push(`/ip dhcp-server set [ find name="${defs.dhcpServerName}" ] add-arp=${defs.addArpForLeases ? "yes" : "no"}`);

  // Network ensure
  lines.push(
    "",
    `/ip dhcp-server network`,
    `:if ([:len [/ip dhcp-server network find where address="${defs.networkCidr}"]] = 0) do={`,
    `  add address=${defs.networkCidr} gateway=${defs.gateway} dns-server=${dnsServers} comment="Omnicore network"`,
    `}`
  );

  // Server ensure / update
  lines.push(
    "",
    `# Ensure DHCP server exists`,
    `/ip dhcp-server`,
    `:if ([:len [find where name="${defs.dhcpServerName}"]] = 0) do={`,
    `  add name="${defs.dhcpServerName}" interface=${defs.interface} address-pool="" lease-time="${defs.leaseTime}" disabled=no`,
    `} else={`,
    `  set [ find name="${defs.dhcpServerName}" ] interface=${defs.interface} lease-time="${defs.leaseTime}"`,
    `}`
  );

  // Static leases
  lines.push("", `# Static leases`);
  rows.forEach((d) => {
    if (!d.mac || !d.ip) return;
    const comment = d.comment || d.hostname || "";
    lines.push(
      `/ip dhcp-server lease`,
      `:if ([:len [find where mac-address="${d.mac}" || address="${d.ip}"]] = 0) do={`,
      `  add mac-address=${d.mac} address=${d.ip} server="${defs.dhcpServerName}" comment="${escapeComment(comment)}"`,
      `} else={`,
      `  set [ find where (mac-address="${d.mac}" || address="${d.ip}") ] server="${defs.dhcpServerName}" comment="${escapeComment(comment)}"`,
      `}`
    );
  });

  lines.push("", `# End`);
  return lines.join("\n");
}

/* =========================
   Theme + CRT wiring
========================= */
function useCrtChrome(mode: UIMode) {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    if (mode === "light") {
      root.removeAttribute("data-crt");
      root.removeAttribute("data-scan");
      body.style.fontFamily = '"Helvetica Neue", Helvetica, Arial, sans-serif';
      body.style.fontSize = "17px";
      body.style.backgroundImage = "";
      body.style.backgroundColor = "#f8fafc";
    } else {
      root.setAttribute("data-crt", mode === "terminal-amber" ? "amber" : "green");
      root.setAttribute("data-scan", "heavy");
      body.style.fontFamily =
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace';
      body.style.fontSize = "";
      body.style.backgroundImage =
        "repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 2px, rgba(0,0,0,0.25) 2px, rgba(0,0,0,0.25) 4px)";
      body.style.backgroundColor = mode === "terminal-amber" ? "#2a1f0b" : "#0b1b0f";
    }
  }, [mode]);
}

/* =========================
   Tiny LED
========================= */
function PowerLED({ mode }: { mode: UIMode }) {
  const isAmber = mode === "terminal-amber";
  return (
    <span
      title="CRT Power"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 999,
        marginLeft: 12,
        boxShadow: isAmber
          ? "0 0 6px rgba(255,145,0,.9), 0 0 18px rgba(255,145,0,.5)"
          : "0 0 6px rgba(0,255,120,.9), 0 0 18px rgba(0,255,120,.4)",
        background: isAmber ? "#ff9100" : "#00ff78",
        animation: isAmber ? "none" : "blink 1.6s steps(1,end) infinite",
      }}
    />
  );
}

/* =========================
   Tailwind-only tokens per theme
========================= */
function useThemeClasses(mode: UIMode) {
  if (mode === "light") {
    return {
      page: "min-h-screen bg-slate-50 text-slate-800",
      nav: "bg-white border-b border-slate-200",
      card: "bg-white/90 border border-slate-200 shadow-sm rounded-xl",
      cardHeader: "text-slate-900",
      input:
        "w-full rounded-md border border-slate-300 bg-white/90 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400",
      select:
        "w-full rounded-md border border-slate-300 bg-white/90 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400",
      checkbox: "h-4 w-4 accent-blue-600",
      btn:
        "inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 active:scale-[.99]",
      btnGhost:
        "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100",
      btnOutline:
        "inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100",
      table:
        "w-full text-left text-sm border border-slate-200 rounded-lg overflow-hidden",
      th: "bg-slate-100 font-semibold px-3 py-2 border-b border-slate-200",
      td: "px-3 py-2 border-b border-slate-200",
      zebra: "odd:bg-white even:bg-slate-50/60",
      textarea:
        "w-full rounded-md border border-slate-300 bg-white/90 px-3 py-2 font-mono text-sm min-h-[260px] focus:outline-none focus:ring-2 focus:ring-blue-400",
      title: "text-2xl font-extrabold tracking-wide text-center mb-4",
    };
  }

  const isAmber = mode === "terminal-amber";
  const cardBg = isAmber ? "bg-[#1f160c]/80" : "bg-[#0d1c12]/80";
  const border = isAmber ? "border-[#5a3b1a]/60" : "border-[#24452c]/70";
  const text = isAmber ? "text-[#e8d3a6]" : "text-[#d0ffd9]";
  const label = isAmber ? "text-[#c8b189]" : "text-[#b6f5c5]";
  const focus = isAmber ? "focus:ring-[#ffb55c]" : "focus:ring-[#29ffa3]";

  return {
    page: "min-h-screen text-green-100",
    nav: `${cardBg} border-b ${border}`,
    card: `${cardBg} ${border} border shadow-[0_0_0_1px_rgba(0,0,0,.2),0_8px_24px_rgba(0,0,0,.25)] rounded-xl`,
    cardHeader: text,
    input: `w-full rounded-md border ${border} bg-transparent px-3 py-2 text-sm ${text} placeholder-opacity-60 focus:outline-none ${focus} focus:ring-2`,
    select: `w-full rounded-md border ${border} bg-transparent px-3 py-2 text-sm ${text} focus:outline-none ${focus} focus:ring-2`,
    checkbox: "h-4 w-4 accent-[#00ff78]",
    btn:
      "inline-flex items-center rounded-md bg-[#0b2a19] px-3 py-1.5 text-sm font-semibold text-[#b6f5c5] hover:bg-[#0d331f] active:scale-[.99] border border-[#24452c]",
    btnGhost:
      `inline-flex items-center rounded-md px-3 py-1.5 text-sm ${text} hover:bg-black/10`,
    btnOutline:
      `inline-flex items-center rounded-md border ${border} px-3 py-1.5 text-sm ${text} hover:bg-black/10`,
    table:
      `w-full text-left text-sm ${border} border rounded-lg overflow-hidden`,
    th: `font-semibold px-3 py-2 ${border} border-b ${label}`,
    td: `px-3 py-2 ${border} border-b ${text}`,
    zebra: "odd:bg-transparent even:bg-white/5",
    textarea:
      `w-full rounded-md border ${border} bg-transparent px-3 py-2 font-mono text-sm min-h-[260px] text-[#c7f9d4] focus:outline-none focus:ring-2 ${focus}`,
    title: "text-center mb-4",
  };
}

/* =========================
   Theme Picker
========================= */
function ThemePicker({
  mode,
  setMode,
}: {
  mode: UIMode;
  setMode: (m: UIMode) => void;
}) {
  const t = useThemeClasses(mode);
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs opacity-70">Theme</label>
      <select
        className={t.select}
        value={mode}
        onChange={(e) => setMode(e.target.value as UIMode)}
      >
        <option value="terminal-green">Terminal Green</option>
        <option value="terminal-amber">Terminal Amber</option>
        <option value="light">Light</option>
      </select>
    </div>
  );
}

/* =========================
   Inputs / Toggles (Tailwind only)
========================= */
function Text({
  label,
  value,
  onChange,
  placeholder,
  error,
  disabled,
  uiMode,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  uiMode: UIMode;
}) {
  const t = useThemeClasses(uiMode);
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs opacity-70">{label}</label>
      <input
        className={t.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {error ? <span className="text-xs text-red-400 mt-0.5">{error}</span> : null}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  uiMode,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  uiMode: UIMode;
}) {
  const t = useThemeClasses(uiMode);
  return (
    <label className="inline-flex items-center gap-2 select-none">
      <span className="text-sm opacity-80">{label}</span>
      <input
        type="checkbox"
        className={t.checkbox}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/* =========================
   Defaults Card
========================= */
function DefaultsCard({
  defaults,
  setDefaults,
  uiMode,
}: {
  defaults: Defaults;
  setDefaults: (d: Defaults) => void;
  uiMode: UIMode;
}) {
  const t = useThemeClasses(uiMode);
  const errs = {
    cidr:
      defaults.networkCidr && !isCidr(defaults.networkCidr)
        ? "Invalid CIDR (e.g. 10.0.0.0/24)"
        : "",
    gw:
      defaults.gateway && !isIPv4(defaults.gateway)
        ? "Invalid IPv4 address"
        : "",
    dns:
      defaults.dnsServers && !commaListIPsOrHostnames(defaults.dnsServers)
        ? "Comma-list IPv4 or hostnames"
        : "",
  };

  return (
    <section className={t.card}>
      <div className="p-6">
        {/* Banner image in all themes */}
        <div className="flex justify-center mb-5">
          <img
            src={OmnicoreLogo}
            alt="OMNICORE"
            className="max-h-16 md:max-h-20 w-auto opacity-95 pointer-events-none select-none"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Text
            label="DHCP Server Name"
            value={defaults.dhcpServerName}
            onChange={(v) => setDefaults({ ...defaults, dhcpServerName: v })}
            placeholder="primary_dhcp_server"
            uiMode={uiMode}
          />
          <Text
            label="Interface"
            value={defaults.interface}
            onChange={(v) => setDefaults({ ...defaults, interface: v })}
            placeholder="bridge"
            uiMode={uiMode}
          />
          <Text
            label="Network (CIDR)"
            value={defaults.networkCidr}
            onChange={(v) => setDefaults({ ...defaults, networkCidr: v })}
            placeholder="172.16.10.0/24"
            error={errs.cidr}
            uiMode={uiMode}
          />
          <Text
            label="Gateway"
            value={defaults.gateway}
            onChange={(v) => setDefaults({ ...defaults, gateway: v })}
            placeholder="192.168.1.1"
            error={errs.gw}
            uiMode={uiMode}
          />
          <Text
            label="DNS Servers"
            value={defaults.dnsServers}
            onChange={(v) => setDefaults({ ...defaults, dnsServers: v })}
            placeholder="1.1.1.1,9.9.9.9"
            error={errs.dns}
            uiMode={uiMode}
          />
          <Text
            label="Lease Time"
            value={defaults.leaseTime}
            onChange={(v) => setDefaults({ ...defaults, leaseTime: v })}
            placeholder="1d 00:00:00"
            uiMode={uiMode}
          />
        </div>

        <div className="mt-4 flex gap-6">
          <Toggle
            label="Authoritative"
            checked={defaults.authoritative}
            onChange={(v) => setDefaults({ ...defaults, authoritative: v })}
            uiMode={uiMode}
          />
          <Toggle
            label="Add ARP for Leases"
            checked={defaults.addArpForLeases}
            onChange={(v) => setDefaults({ ...defaults, addArpForLeases: v })}
            uiMode={uiMode}
          />
        </div>
      </div>
    </section>
  );
}

/* =========================
   Device Table
========================= */
function DeviceTable({
  devices,
  setDevices,
  uiMode,
}: {
  devices: Row[];
  setDevices: (rows: Row[]) => void;
  uiMode: UIMode;
}) {
  const t = useThemeClasses(uiMode);
  const fileRouterRef = useRef<HTMLInputElement | null>(null);
  const fileDefaultsRef = useRef<HTMLInputElement | null>(null);

  function validate(rows: Row[]): Row[] {
    return rows.map((d) => {
      const errors: Row["errors"] = {};
      if (!d.mac) errors.mac = "Required";
      else if (!isMac(d.mac)) errors.mac = "Invalid MAC (AA:BB:CC:DD:EE:FF)";
      if (!d.ip) errors.ip = "Required";
      else if (!isIPv4(d.ip)) errors.ip = "Invalid IPv4";
      return { ...d, errors };
    });
  }

  function update(idx: number, patch: Partial<Row>) {
    const next = devices.slice();
    // inline formatting helpers
    if (patch.mac !== undefined) {
      let m = patch.mac.toUpperCase().replace(/[^0-9A-F]/g, "");
      // inject :
      m = m
        .match(/.{1,2}/g)
        ?.slice(0, 6)
        .join(":") ?? "";
      patch.mac = m;
    }
    if (patch.ip !== undefined) {
      const parts = patch.ip.split(".").map((p) => p.replace(/\D/g, ""));
      for (let i = 0; i < parts.length; i++) {
        const n = Math.min(255, Math.max(0, Number(parts[i] || "0")));
        parts[i] = String(n);
      }
      patch.ip = parts.filter((p, i) => i < 4).join(".");
    }
    next[idx] = { ...next[idx], ...patch };
    setDevices(validate(next));
  }

  function addRow() {
    setDevices([
      ...devices,
      {
        id: crypto.randomUUID(),
        hostname: "",
        mac: "",
        ip: "",
        comment: "",
      },
    ]);
  }

  function removeRow(id: string) {
    setDevices(devices.filter((d) => d.id !== id));
  }

  async function importRouterCsv(file: File) {
    const text = await file.text();
    const rows = parseCsv(text);
    // heuristic: columns named mac-address / address / comment / host-name
    const header = rows[0]?.map((h) => h.toLowerCase());
    const macIdx = header?.findIndex((h) => h.includes("mac")) ?? -1;
    const ipIdx = header?.findIndex((h) => h === "address" || h.includes("ip")) ?? -1;
    const hostIdx = header?.findIndex((h) => h.includes("host")) ?? -1;
    const commentIdx = header?.findIndex((h) => h.includes("comment")) ?? -1;

    const newRows: Row[] = rows
      .slice(1)
      .filter((r) => r.length > 0 && (r[macIdx] || r[ipIdx]))
      .map((r) => ({
        id: crypto.randomUUID(),
        hostname: r[hostIdx] || "",
        mac: (r[macIdx] || "").toUpperCase(),
        ip: r[ipIdx] || "",
        comment: r[commentIdx] || "",
      }));

    setDevices(validate([...devices, ...newRows]));
  }

  async function importDefaultsCsv(file: File) {
    // devices csv expected columns: hostname,mac,ip,comment
    const text = await file.text();
    const rows = parseCsv(text);
    const header = rows[0]?.map((h) => h.toLowerCase());
    const getIdx = (n: string) => header?.findIndex((h) => h === n) ?? -1;

    const hostnameIdx = getIdx("hostname");
    const macIdx = getIdx("mac");
    const ipIdx = getIdx("ip");
    const commentIdx = getIdx("comment");

    const newRows: Row[] = rows
      .slice(1)
      .filter((r) => r.length > 0 && (r[macIdx] || r[ipIdx]))
      .map((r) => ({
        id: crypto.randomUUID(),
        hostname: r[hostnameIdx] || "",
        mac: (r[macIdx] || "").toUpperCase(),
        ip: r[ipIdx] || "",
        comment: r[commentIdx] || "",
      }));

    setDevices(validate([...devices, ...newRows]));
  }

  function exportCsv() {
    const header = ["hostname", "mac", "ip", "comment"];
    const lines = [header.join(",")].concat(
      devices.map((d) =>
        [d.hostname || "", d.mac || "", d.ip || "", d.comment || ""]
          .map((v) => `"${(v || "").replace(/"/g, '""')}"`)
          .join(",")
      )
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "devices.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clearDevices() {
    setDevices([]);
  }

  return (
    <section className={useThemeClasses(uiMode).card}>
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Device Leases</h2>
          <div className="flex gap-2">
            {/* Import Leases CSV (left) */}
            <button
              className={useThemeClasses(uiMode).btnOutline}
              onClick={() => fileRouterRef.current?.click()}
            >
              Import Leases CSV
            </button>
            <input
              ref={fileRouterRef}
              type="file"
              accept=".csv,.txt,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importRouterCsv(f);
                e.currentTarget.value = "";
              }}
            />

            {/* Import Defaults CSV (right) */}
            <button
              className={useThemeClasses(uiMode).btnOutline}
              onClick={() => fileDefaultsRef.current?.click()}
            >
              Import Defaults CSV
            </button>
            <input
              ref={fileDefaultsRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importDefaultsCsv(f);
                e.currentTarget.value = "";
              }}
            />

            <button className={useThemeClasses(uiMode).btnOutline} onClick={exportCsv}>
              Export CSV
            </button>
            <button className={useThemeClasses(uiMode).btn} onClick={addRow}>
              + Add Row
            </button>
          </div>
        </div>

        <div className="overflow-x-auto mt-4 rounded-lg">
          <table className={`${useThemeClasses(uiMode).table}`}>
            <thead>
              <tr>
                <th className={useThemeClasses(uiMode).th}>Hostname</th>
                <th className={useThemeClasses(uiMode).th}>MAC (required)</th>
                <th className={useThemeClasses(uiMode).th}>IP (required)</th>
                <th className={useThemeClasses(uiMode).th}>Comment</th>
                <th className={`${useThemeClasses(uiMode).th} w-28`}></th>
              </tr>
            </thead>
            <tbody className={useThemeClasses(uiMode).zebra}>
              {devices.map((d, i) => (
                <tr key={d.id}>
                  <td className={useThemeClasses(uiMode).td}>
                    <input
                      className={`${useThemeClasses(uiMode).input}`}
                      value={d.hostname}
                      onChange={(e) => update(i, { hostname: e.target.value })}
                      onBlur={() => update(i, { hostname: d.hostname })}
                      placeholder="MEDIA-SERVER"
                    />
                  </td>
                  <td className={useThemeClasses(uiMode).td}>
                    <input
                      className={`${useThemeClasses(uiMode).input} ${d.errors?.mac ? "ring-1 ring-red-400" : ""}`}
                      value={d.mac}
                      onChange={(e) => update(i, { mac: e.target.value })}
                      onBlur={() => update(i, { mac: d.mac })}
                      placeholder="00:1A:2B:3C:4D:5E"
                    />
                    {d.errors?.mac && <span className="text-xs text-red-400">{d.errors.mac}</span>}
                  </td>
                  <td className={useThemeClasses(uiMode).td}>
                    <input
                      className={`${useThemeClasses(uiMode).input} ${d.errors?.ip ? "ring-1 ring-red-400" : ""}`}
                      value={d.ip}
                      onChange={(e) => update(i, { ip: e.target.value })}
                      onBlur={() => update(i, { ip: d.ip })}
                      placeholder="172.16.10.25"
                    />
                    {d.errors?.ip && <span className="text-xs text-red-400">{d.errors.ip}</span>}
                  </td>
                  <td className={useThemeClasses(uiMode).td}>
                    <input
                      className={`${useThemeClasses(uiMode).input}`}
                      value={d.comment || ""}
                      onChange={(e) => update(i, { comment: e.target.value })}
                      placeholder="IoT Smart Hub"
                    />
                  </td>
                  <td className={useThemeClasses(uiMode).td}>
                    <button
                      className={`${useThemeClasses(uiMode).btnGhost} text-red-400`}
                      onClick={() => removeRow(d.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {devices.length === 0 && (
                <tr>
                  <td colSpan={5} className={`${useThemeClasses(uiMode).td} text-center opacity-70`}>
                    No rows yet. Add your first device lease.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* =========================
   Current Router Leases (read-only) - placed LAST
========================= */
function RouterLeasesCard({
  leases,
  onClear,
  uiMode,
}: {
  leases: Row[];
  onClear: () => void;
  uiMode: UIMode;
}) {
  const t = useThemeClasses(uiMode);
  return (
    <section className={t.card}>
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Current Router Leases (Read‑only)</h2>
          <div className="flex gap-2">
            <button className={t.btnOutline} onClick={onClear}>
              Clear Table
            </button>
          </div>
        </div>
        <div className="overflow-x-auto mt-4 rounded-lg">
          <table className={t.table}>
            <thead>
              <tr>
                <th className={t.th}>Hostname</th>
                <th className={t.th}>MAC</th>
                <th className={t.th}>IP</th>
                <th className={t.th}>Comment</th>
              </tr>
            </thead>
            <tbody className={t.zebra}>
              {leases.length ? (
                leases.map((d) => (
                  <tr key={d.id}>
                    <td className={t.td}>{d.hostname}</td>
                    <td className={t.td}>{d.mac}</td>
                    <td className={t.td}>{d.ip}</td>
                    <td className={t.td}>{d.comment}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className={`${t.td} text-center opacity-70`}>
                    No data. Import a Leases CSV in the Device Leases card to populate this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* =========================
   Output Card
========================= */
function OutputCard({
  script,
  hasRealScript,
  onGenerate,
  onCopy,
  onDownload,
  onReset,
  uiMode,
}: {
  script: string;
  hasRealScript: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onReset: () => void;
  uiMode: UIMode;
}) {
  const t = useThemeClasses(uiMode);
  const canExport = hasRealScript && ALLOW_EXPORT;

  return (
    <section className={t.card}>
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Output Script</h2>
          <div className="flex gap-2">
            <button className={t.btn} onClick={onGenerate}>
              Generate Script
            </button>
            {canExport && (
              <>
                <button className={t.btnOutline} onClick={onCopy}>
                  Copy
                </button>
                <button className={t.btnOutline} onClick={onDownload}>
                  Download .rsc
                </button>
              </>
            )}
            <button className={t.btnOutline} onClick={onReset}>
              Reset
            </button>
          </div>
        </div>

        <textarea
          className={t.textarea}
          value={script}
          readOnly
          placeholder="Generated RouterOS script will appear here…"
        />
      </div>
    </section>
  );
}

/* =========================
   Utilities
========================= */
function parseCsv(text: string): string[][] {
  // simple CSV: split on lines, then commas; handles quoted cells
  const lines = text.replace(/\r/g, "").split("\n");
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") {
          cells.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

function cleanRow(d: Row): Row {
  return {
    ...d,
    hostname: d.hostname.trim(),
    mac: d.mac.trim(),
    ip: d.ip.trim(),
    comment: (d.comment || "").trim(),
  };
}

/* =========================
   Defaults
========================= */
const DEFAULT_DEFAULTS: Defaults = {
  dhcpServerName: "primary_dhcp_server",
  interface: "bridge",
  networkCidr: "172.16.10.0/24",
  gateway: "192.168.1.1",
  dnsServers: "1.1.1.1,9.9.9.9",
  leaseTime: "1d 00:00:00",
  authoritative: true,
  addArpForLeases: true,
};

/* =========================
   App
========================= */
export default function App() {
  const [uiMode, setUiMode] = useLocalStorage<UIMode>("oc-mode", "terminal-green");
  useCrtChrome(uiMode);

  const [defaults, setDefaults] = useLocalStorage<Defaults>("oc-defaults", DEFAULT_DEFAULTS);
  const [devices, setDevices] = useLocalStorage<Row[]>("oc-devices", []);
  const [routerLeases, setRouterLeases] = useLocalStorage<Row[]>("oc-router-leases", []);
  const [script, setScript] = useState<string>("");
  const [hasRealScript, setHasRealScript] = useState<boolean>(false);

  // Live preview for the textbox; buttons rely on hasRealScript
  const scriptPreview = useMemo(
    () => generateMikroTikScript(defaults, devices.map(cleanRow)),
    [defaults, devices]
  );

  function handleGenerate() {
    const s = generateMikroTikScript(defaults, devices.map(cleanRow));
    setScript(s);
    setHasRealScript(true);
  }

  async function handleCopy() {
    if (!hasRealScript || !script) return;
    try {
      await navigator.clipboard.writeText(script);
      toast("Copied script to clipboard");
    } catch {
      toast("Clipboard unavailable");
    }
  }

  function handleDownload() {
    if (!hasRealScript || !script) return;
    const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `omnicore_dhcp_${new Date().toISOString().replace(/[:.]/g, "-")}.rsc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleReset() {
    setDefaults(DEFAULT_DEFAULTS);
    setDevices([]);
    setRouterLeases([]);
    setScript("");
    setHasRealScript(false);
    try {
      localStorage.removeItem("oc-defaults");
      localStorage.removeItem("oc-devices");
      localStorage.removeItem("oc-router-leases");
    } catch {}
    toast("Reset to defaults");
  }

  // Mirror imported leases into read-only table on first import
  useEffect(() => {
    if (routerLeases.length === 0 && devices.length > 0) {
      setRouterLeases(devices.map(cleanRow));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tiny toast
  const [toastMsg, setToastMsg] = useState<string>("");
  function toast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 1800);
  }

  const t = useThemeClasses(uiMode);

  return (
    <div className={t.page}>
      <style>{`@keyframes blink{0%{opacity:.15}50%{opacity:1}100%{opacity:.15}}`}</style>

      {/* Top bar */}
      <div className={`w-full ${t.nav}`}>
        <div className="mx-auto max-w-[1100px] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-lg font-semibold">Omnicore Lease Builder</span>
            <PowerLED mode={uiMode} />
          </div>
          <ThemePicker mode={uiMode} setMode={setUiMode} />
        </div>
      </div>

      <main
        className="container mx-auto max-w-[1100px] px-4 py-6 flex flex-col gap-6"
        style={uiMode === "light" ? { fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', fontSize: "17px" } : undefined}
      >
        <DefaultsCard defaults={defaults} setDefaults={setDefaults} uiMode={uiMode} />
        <DeviceTable devices={devices} setDevices={setDevices} uiMode={uiMode} />
        <OutputCard
          script={hasRealScript ? script : scriptPreview}
          hasRealScript={hasRealScript}
          onGenerate={handleGenerate}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onReset={handleReset}
          uiMode={uiMode}
        />
        <RouterLeasesCard leases={routerLeases} onClear={() => setRouterLeases([])} uiMode={uiMode} />
      </main>

      {/* Toast (bottom-right) */}
      {toastMsg && (
        <div className="fixed bottom-4 right-4 rounded-md bg-black/80 text-white px-3 py-2 text-sm shadow-lg">
          {toastMsg}
        </div>
      )}

      <footer className="mt-10 pb-10 text-center opacity-70">
        <p>Built with React + Vite + Tailwind • RouterOS script output</p>
        <a
          className="underline"
          href="https://github.com/justinfarry-arch/omnicore-lease-builder"
          target="_blank"
          rel="noreferrer"
        >
          GitHub Repo
        </a>
      </footer>
    </div>
  );
}