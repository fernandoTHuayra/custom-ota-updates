# Estado del Despliegue v2: Servidor de Actualizaciones OTA

Última actualización: **23 de Febrero 2026**

---

## ✅ Completado

### Fase 1: Análisis y Diseño
- [x] Análisis del script `publish.js` original
- [x] Análisis del mecanismo de almacenamiento (DB/Assets)
- [x] Creación de la guía de despliegue

### Fase 2: Simulación Local de Producción
- [x] **Stack elegido**: SQLite + Storage Local (carpeta pública)
- [x] **Dependencias instaladas**: `sqlite3`, `sqlite` (open)
- [x] **Adaptadores abstractos**: Interfaces `DatabaseAdapter` y `StorageAdapter` creadas
- [x] **SQLite Adapter** (`src/adapters/database.ts`): Lee/escribe actualizaciones en `updates.db`
- [x] **Local Storage Adapter** (`src/adapters/storage.ts`): Guarda assets en `public/updates/assets`
- [x] **manifest.ts refactorizado**: Usa `dbAdapter` para consultar actualizaciones
- [x] **init-db.js creado**: Inicializa las tablas `updates`, `assets`, `update_assets`
- [x] **publish.js refactorizado**: Función `uploadAsset()` aislada para fácil migración a R2/S3
- [x] **publish.sh deprecado**: Eliminado (no actualizaba la DB)
- [x] **Limpieza de base de datos**: `updates.db` reinicializada limpia
- [x] **.gitignore actualizado**: Excluye `updates.db`, `public/updates/`, `*.pem`, `*.log`

### Fase 3: Despliegue en VPS (Parcialmente completado)
- [x] **Guía de despliegue adaptada** para Webmin/Virtualmin (usuario sin `sudo`)
- [x] **Código subido a GitHub**: Repo `fernandoTHuayra/custom-ota-updates`
- [x] **Servidor diagnosticado**:
  - ✅ Node.js v22 (instalado vía nvm)
  - ✅ Yarn 1.22.19
  - ✅ Git 2.34.1
  - ❌ Sin acceso `sudo` (usuario `otaupdates`)
  - ❌ Cuota de disco limitada (~10GB)
- [x] **Repo clonado en servidor**: `~/custom-ota-updates/expo-updates-server`
- [x] **Dependencias instaladas en servidor**: `yarn install` exitoso

---

## 🔄 En Progreso

### Build del Servidor
- [ ] **Corregir errores de linting**: Se aplicaron fixes de Prettier/ESLint en:
  - `src/adapters/database.ts` (indentación, import order, `readonly`, `??`)
  - `src/adapters/storage.ts` (import order, `readonly`, `??`)
  - `pages/api/manifest.ts` (newline final)
- [ ] **Ejecutar `yarn build` exitosamente en el servidor**

---

## ❌ Pendiente

### Configuración del Servidor
| Tarea | Detalle | Estado |
|:------|:--------|:-------|
| PM2 | Instalar localmente (`npm install pm2@latest -g`) | ❌ Pendiente |
| Inicializar DB | Ejecutar `node scripts/init-db.js` en servidor | ❌ Pendiente |
| Claves de firma | Copiar `code-signing-keys/` al servidor vía SCP | ❌ Pendiente |
| Build | `yarn build` (requiere linting limpio) | ❌ Pendiente |
| Iniciar app | `pm2 start npm --name "expo-updates" -- start` | ❌ Pendiente |

### Configuración de Red (Webmin/Virtualmin)
| Tarea | Detalle | Estado |
|:------|:--------|:-------|
| Acceso a Webmin | Puerto 10000 bloqueado por firewall (túnel SSH falló) | ⚠️ Bloqueado |
| Proxy reverso | Configurar tráfico `dominio → localhost:3000` | ❌ Pendiente |
| SSL/HTTPS | Let's Encrypt vía panel Virtualmin | ❌ Pendiente |

### Configuración del Cliente (Post-Deploy)
| Tarea | Detalle | Estado |
|:------|:--------|:-------|
| Actualizar `app.json` | Cambiar URL a `https://updates.tudominio.com/api/manifest` | ❌ Pendiente |
| Desactivar cleartext | Remover `usesCleartextTraffic: true` | ❌ Pendiente |
| Variable de entorno | Setear `ASSETS_BASE_URL` en servidor | ❌ Pendiente |

---

## 🏗 Arquitectura Objetivo

```
┌─────────────────────────────────────────────────────────┐
│                    VPS (Webmin)                          │
│  ┌──────────┐    ┌──────────────────────────────────┐   │
│  │  Nginx   │───▶│   Next.js (Puerto 3000)          │   │
│  │ (Proxy)  │    │   ├── /api/manifest (API)        │   │
│  │ SSL/443  │    │   ├── /updates/assets (Estáticos) │   │
│  └──────────┘    │   └── updates.db (SQLite)         │   │
│                  └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTPS
                    ┌──────┴──────┐
                    │  App Móvil  │
                    │  (Expo)     │
                    └─────────────┘
```

## 📋 Flujo de Publicación (una vez desplegado)

```
PC Local                          Servidor VPS
────────                          ────────────
1. Programar cambios
2. git push          ──────▶     3. git pull
                                 4. yarn install
                                 5. yarn expo-publish
                                    ├── expo export
                                    ├── Copia assets a public/
                                    └── Registra en SQLite
```

## ⚠️ Riesgos Conocidos

1. **Disco limitado (10GB)**: Los assets se guardan en disco local. Se recomienda migrar `uploadAsset()` a **Cloudflare R2** (gratis hasta 10GB/mes) para evitar llenar la cuota.
2. **Sin `sudo`**: No podemos instalar paquetes del sistema. PM2 debe instalarse localmente.
3. **SQLite en producción**: Funciona para un solo servidor, pero NO escala a múltiples instancias.
4. **Acceso a Webmin bloqueado**: El puerto 10000 está cerrado por firewall. Se necesita contactar al administrador del servidor o usar un plan alternativo (localtunnel).

---

## 📊 Cambios respecto a DEPLOYMENT_STATUS.md (v1)

| Aspecto | v1 (Original) | v2 (Actual) |
|:--------|:--------------|:------------|
| **Hosting** | Plan genérico (VPS/Serverless) | VPS Webmin/Virtualmin confirmado, sin `sudo` |
| **DB** | Planificaba migrar a PostgreSQL | Se mantiene SQLite (suficiente para 1 servidor) |
| **Storage** | Planificaba migrar a S3/R2 | Se mantiene local por ahora, `uploadAsset()` listo para migrar |
| **Código** | Prototipo funcional local | Código en GitHub, parcialmente desplegado en servidor |
| **Servidor** | Sin diagnosticar | Node 22, Yarn, Git instalados. Build pendiente |
