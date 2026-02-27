# Estado del Despliegue v3: Servidor de Actualizaciones OTA

Última actualización: **24 de Febrero 2026**

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

- [x] **Código subido a GitHub**: Repo `fernandoTHuayra/custom-ota-updates`
- [x] **Servidor diagnosticado**:
  - ✅ Node.js v22 (instalado vía nvm)
  - ✅ Yarn 1.22.19
  - ✅ Git 2.34.1
  - ❌ Sin acceso `sudo` (usuario `otaupdates`)
  - ❌ Cuota de disco limitada (~10GB)
- [x] **Repo clonado en servidor**: `~/custom-ota-updates/expo-updates-server`
- [x] **Dependencias instaladas en servidor**: `yarn install` exitoso

### Fase 4: HTTPS Directo (sin Nginx)

- [x] **Decisión de arquitectura**: Node.js sirve HTTPS directamente en :3000, usando certificados de Virtualmin/Let's Encrypt. No se necesita Nginx ni Apache.
- [x] **Custom server creado** (`server.js`): Servidor Node.js que:
  - Lee certificados SSL desde variables de entorno (`SSL_CERT_PATH`, `SSL_KEY_PATH`, `SSL_CA_PATH`)
  - Crea `https.createServer()` con el request handler de Next.js
  - Escucha en puerto 3000 (configurable con `PORT`)
  - Fallback automático a HTTP si no hay certificados (para desarrollo local)
- [x] **Script `start` actualizado**: `package.json` ahora usa `node server.js` en vez de `next start`
- [x] **Variables de entorno de producción** (`.env.production`):
  - `HOSTNAME=https://otaupdates.huayra.com.ar:3000`
  - `ASSETS_BASE_URL=https://otaupdates.huayra.com.ar:3000/updates/assets`
  - Rutas SSL apuntando a `/home/otaupdates/ssl/`
- [x] **Supervisor definido** (`deploy/supervisor/updates-server.conf`):
  - Ejecuta `node server.js` con variables de entorno de producción
  - `autostart=true` y `autorestart=true`
  - Logs separados en `logs/supervisor/`
- [x] **Script post-renovación creado** (`deploy/supervisor/post-renew-certificates.sh`):
  - Copia `ssl.cert`, `ssl.key` y `ssl.ca` desde Virtualmin al home del usuario
  - Ajusta permisos (`600` para key, `644` para cert/ca)
  - Reinicia `updates-server` vía `supervisorctl`
- [x] **URL del cliente actualizada** (`expo-updates-client/app.json`):
  - `https://otaupdates.huayra.com.ar:3000/api/manifest`
- [x] **Build verificado**: `yarn build` exitoso localmente

---

## ❌ Pendiente (Tareas en el VPS)

### 1. Certificados SSL

| Tarea                | Detalle                                                                                                                                              | Estado            |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------- |
| Copiar certs al home | Los certs están en `/etc/ssl/virtualmin/1691420266222853/` pero el usuario `otaupdates` no tiene acceso. Hay que copiarlos a `/home/otaupdates/ssl/` | ⚠️ Requiere admin |

**Acción requerida** — Desde Virtualmin o pedirle al admin:

```bash
mkdir -p /home/otaupdates/ssl
cp /etc/ssl/virtualmin/1691420266222853/ssl.cert /home/otaupdates/ssl/
cp /etc/ssl/virtualmin/1691420266222853/ssl.key  /home/otaupdates/ssl/
cp /etc/ssl/virtualmin/1691420266222853/ssl.ca   /home/otaupdates/ssl/
chown otaupdates:otaupdates /home/otaupdates/ssl/*
chmod 600 /home/otaupdates/ssl/ssl.key
chmod 644 /home/otaupdates/ssl/ssl.cert /home/otaupdates/ssl/ssl.ca
```

### 2. Deploy en Servidor

| #   | Tarea                    | Comando                                                                                        | Estado |
| :-- | :----------------------- | :--------------------------------------------------------------------------------------------- | :----- |
| 1   | Pull del código nuevo    | `cd ~/custom-ota-updates && git pull`                                                          | ❌     |
| 2   | Instalar dependencias    | `cd expo-updates-server && yarn install`                                                       | ❌     |
| 3   | Build de producción      | `yarn build`                                                                                   | ❌     |
| 4   | Inicializar DB           | `node scripts/init-db.js`                                                                      | ❌     |
| 5   | Copiar claves de firma   | `scp code-signing-keys/* servidor:~/custom-ota-updates/expo-updates-server/code-signing-keys/` | ❌     |
| 6   | Copiar config Supervisor | Copiar `deploy/supervisor/updates-server.conf` a la ruta de `supervisord`                      | ❌     |
| 7   | Recargar Supervisor      | `sudo supervisorctl reread && sudo supervisorctl update`                                       | ❌     |
| 8   | Iniciar servicio         | `sudo supervisorctl start updates-server`                                                      | ❌     |

### 3. Firewall / Red

| Tarea             | Detalle                                                             | Estado |
| :---------------- | :------------------------------------------------------------------ | :----- |
| Abrir puerto 3000 | En Virtualmin/Webmin, habilitar tráfico entrante TCP en puerto 3000 | ❌     |
| Verificar DNS     | Confirmar que `otaupdates.huayra.com.ar` resuelve a la IP del VPS   | ❌     |

### 4. Renovación Automática de Certificados

| Tarea                | Detalle                                                                                                 | Estado |
| :------------------- | :------------------------------------------------------------------------------------------------------ | :----- |
| Hook post-renovación | Registrar `deploy/supervisor/post-renew-certificates.sh` en certbot/Virtualmin para ejecutar post-renew | 🔄     |

### 5. Cliente Expo (Post-Deploy)

| Tarea                      | Detalle                                                                          | Estado |
| :------------------------- | :------------------------------------------------------------------------------- | :----- |
| Rebuild de la app          | `npx expo prebuild --clean` + build Android (necesario porque `app.json` cambió) | ❌     |
| Opcional: quitar cleartext | Remover `usesCleartextTraffic: true` del plugin `expo-build-properties`          | ❌     |

---

## 🏗 Arquitectura (Actualizada)

```
┌─────────────────────────────────────────────────────────┐
│                    VPS (Virtualmin)                      │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │   Node.js + Next.js (HTTPS :3000)                │   │
│  │   ├── server.js (custom server con TLS)          │   │
│  │   ├── /api/manifest (API de actualizaciones)     │   │
│  │   ├── /api/assets (Archivos de assets)           │   │
│  │   ├── /updates/assets (Assets estáticos)         │   │
│  │   └── updates.db (SQLite)                        │   │
│  └──────────────────────────────────────────────────┘   │
│       │                                                 │
│       │ Lee certificados de                             │
│       ▼                                                 │
│  /home/otaupdates/ssl/                                  │
│       ├── ssl.cert (Certificado)                        │
│       ├── ssl.key  (Clave privada)                      │
│       └── ssl.ca   (Cadena CA)                          │
│                                                         │
│  Supervisor (Process Manager)                           │
│       └── Controla el servicio `updates-server`         │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ HTTPS :3000
                   ┌──────┴──────┐
                   │  App Móvil  │
                   │  (Expo)     │
                   └─────────────┘
```

### Lo que cambió vs v2

| Aspecto             | v2 (Plan anterior)                         | v3 (Plan actual)                               |
| :------------------ | :----------------------------------------- | :--------------------------------------------- |
| **SSL/HTTPS**       | Nginx como reverse proxy + SSL termination | ❌ Sin Nginx. Node.js sirve HTTPS directo      |
| **Apache**          | Se consideraba para proxy                  | ❌ No necesario, corre en puerto separado      |
| **Servidor**        | `next start` (HTTP)                        | `node server.js` (HTTPS nativo)                |
| **Process Manager** | PM2                                        | Supervisor (`updates-server.conf`)             |
| **URL del cliente** | Sin definir                                | `https://otaupdates.huayra.com.ar:3000`        |
| **Certificados**    | Pendiente definir mecanismo                | Copiar de Virtualmin a `/home/otaupdates/ssl/` |

---

## 📋 Flujo de Publicación (una vez desplegado)

```
PC Local                          Servidor VPS
────────                          ────────────
1. Programar cambios
2. git push          ──────▶     3. git pull
                                 4. yarn install
                                 5. yarn build (si hay cambios en server)
                                 6. yarn expo-publish
                                    ├── expo export
                                    ├── Copia assets a public/
                                    └── Registra en SQLite
                                 7. supervisorctl restart updates-server (si cambió código del server)
```

## ⚠️ Riesgos Conocidos

1. **Disco limitado (10GB)**: Los assets se guardan en disco local. Considerar migrar `uploadAsset()` a **Cloudflare R2** (gratis hasta 10GB/mes).
2. **Sin `sudo`**: Las operaciones de `supervisorctl` suelen requerir privilegios. Validar con el administrador el flujo permitido para reinicios.
3. **SQLite en producción**: Funciona para un solo servidor, pero NO escala a múltiples instancias.
4. **Permisos de certificados**: El usuario `otaupdates` no puede leer `/etc/ssl/virtualmin/`. Se necesita que el admin copie los certs al home.
5. **Renovación de certs**: Hay que automatizar la copia + reinicio en Supervisor para que no se caiga el HTTPS cuando Let's Encrypt renueve.

---

## 📁 Archivos Nuevos/Modificados (v3)

| Archivo                                                            | Tipo           | Descripción                                    |
| :----------------------------------------------------------------- | :------------- | :--------------------------------------------- |
| `expo-updates-server/server.js`                                    | **Nuevo**      | Custom server Node.js con HTTPS                |
| `expo-updates-server/.env.production`                              | **Nuevo**      | Variables de entorno de producción             |
| `expo-updates-server/deploy/supervisor/updates-server.conf`        | **Nuevo**      | Configuración de Supervisor                    |
| `expo-updates-server/deploy/supervisor/post-renew-certificates.sh` | **Nuevo**      | Hook post-renovación de certificados + restart |
| `expo-updates-server/package.json`                                 | **Modificado** | Script `start` → `node server.js`              |
| `expo-updates-client/app.json`                                     | **Modificado** | URL → `https://otaupdates.huayra.com.ar:3000`  |
