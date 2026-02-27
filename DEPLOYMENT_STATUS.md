# Estado del Despliegue: Servidor de Actualizaciones OTA

Este documento detalla la arquitectura actual del sistema de actualizaciones OTA (Over-The-Air) y la hoja de ruta para su paso a producción.

## 🏗 Arquitectura Actual (Entorno de Desarrollo Local)

Actualmente, todo el ecosistema se ejecuta dentro de una única máquina de desarrollo, simulando una arquitectura cliente-servidor completa.

### 1. El Servidor (`expo-updates-server`)
*   **Tecnología**: Next.js.
*   **Ubicación**: Ejecutándose en `localhost:3000`.
*   **Base de Datos**: **SQLite** (`updates.db`). Es un archivo local situado en la raíz del proyecto del servidor. Almacena los metadatos de cada actualización (ID, fecha, versión de runtime) y el registro de assets.
*   **Almacenamiento de Assets (Storage)**: **Sistema de Archivos Local**. Los archivos (imágenes, bundles JS) se guardan físicamente en la carpeta `public/updates/assets` del servidor y se sirven como archivos estáticos HTTP.
*   **Seguridad**:
    *   **Firma de Código**: Implementada. El servidor firma las respuestas usando una clave privada local (`code-signing-keys/private-key.pem`).
    *   **Protocolo**: HTTP (sin cifrado SSL), lo cual requiere configuración especial en el cliente para desarrollo.

### 2. El Cliente (`expo-updates-client`)
*   **Configuración**: El archivo `app.json` apunta a `http://10.0.2.2:3000/api/manifest`.
    *   *Nota*: `10.0.2.2` es la dirección IP especial que utiliza el Emulador de Android para referirse al `localhost` de la máquina anfitriona.
*   **Seguridad**: Configurado con `usesCleartextTraffic: true` para permitir conexiones HTTP no seguras durante el desarrollo.
*   **Verificación**: Incluye el certificado público (`certificate.pem`) para verificar que las actualizaciones provienen de nuestro servidor legítimo.

### 3. Flujo de Publicación (`publish.js`)
El script de publicación actúa como el puente entre el código y el servidor:
1.  Compila el proyecto (`expo export`).
2.  Mueve los archivos generados a la carpeta pública del servidor local.
3.  Calcula hashes y genera identificadores únicos.
4.  Inserta los registros en la base de datos SQLite local.

---

## 🚀 Hoja de Ruta a Producción

Para llevar este sistema a un entorno real y escalable, es necesario realizar las siguientes migraciones:

| Componente | Estado Actual (Local) | Meta (Producción) | Acción Requerida |
| :--- | :--- | :--- | :--- |
| **Hosting Servidor** | Localhost (Node.js) | VPS (DigitalOcean/EC2) o Serverless (Vercel) | Desplegar el código Next.js. |
| **Base de Datos** | SQLite (Archivo) | PostgreSQL o MySQL (Gestionado) | Migrar esquema a una DB persistente en la nube (ej. Supabase, RDS). SQLite no escala bien en serverless. |
| **Storage Assets** | Disco Local | Object Storage (AWS S3 / Cloudflare R2) | Modificar `uploadAsset` en `publish.js` para subir archivos a la nube en lugar de copiar a disco. |
| **Dominio** | `10.0.2.2:3000` | `https://updates.midominio.com` | Configurar DNS y actualizar `app.json`. |
| **Seguridad** | HTTP (Cleartext) | HTTPS (SSL/TLS) | Obtener certificados SSL. Desactivar `usesCleartextTraffic` en la app. |

## 📝 Resumen para Stakeholders

> "Actualmente tenemos un **prototipo funcional completo** que opera en un entorno controlado (local). El sistema ya realiza todas las funciones críticas: compilar, firmar criptográficamente, registrar y servir actualizaciones. La aplicación móvil ya está configurada para confiar y consumir estas actualizaciones. El paso a producción no requiere reescribir el sistema, sino simplemente **conectar** este motor a servicios de infraestructura real (Nube/Base de Datos) cambiando la configuración de almacenamiento y despliegue."
