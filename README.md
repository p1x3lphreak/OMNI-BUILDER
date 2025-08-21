# OMNICORE LEASE BUILDER

A fast, DaisyUI‑styled React app that generates MikroTik RouterOS `.rsc` scripts to define DHCP defaults and static leases. Designed for clean, repeatable network config in home labs and small networks. Built for **Omnicore Homelab** but useful for anyone managing MikroTik networks.

## ✨ Features
- Card layout with DaisyUI themes (Nord, Corporate, Wireframe)
- DHCP defaults: server name, interface, CIDR, gateway, DNS, lease time
- Toggles: Authoritative, Add ARP for leases
- Device table with live validation (required MAC/IP, format checks, duplicate detection)
- Suggest Next IP (fills lowest free host inside your CIDR, skipping gateway and used IPs)
- CSV import/export for device rows
- Output script: Generate / Copy / Download `.rsc`
- `localStorage` persistence for theme, defaults, and rows

## Quick Start
```bash
npm i
npm run dev
# visit http://localhost:5173/omnicore-lease-builder-ui/ (or / if not using GH Pages base)

### 🖇️ Prerequisites
- [Node.js](https://nodejs.org) (LTS version recommended)
- [Git](https://git-scm.com)

### Clone the repo
```bash
git clone https://github.com/YOUR-USERNAME/omnicore-lease-builder-ui.git
cd omnicore-lease-builder-ui

### 📜 License
MIT License © 2025 Justin Farry