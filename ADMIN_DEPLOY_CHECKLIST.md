# Checklist de Administración VPS (OTA Updates)

Última actualización: **24 de Febrero 2026**

Este documento lista **solo** tareas que requieren intervención del admin (sudo/root, Virtualmin/Webmin, firewall o DNS).

> Nota importante: el **punto 1** es un **bootstrap inicial (una sola vez)** y ejecuta manualmente lo mismo que luego hará `post-renew-certificates.sh` en cada renovación.

---

## Datos del servicio

- Dominio: `otaupdates.huayra.com.ar`
- Puerto del servicio: `3000`
- App service (Supervisor): `updates-server`
- Repo en VPS: `~/custom-ota-updates/expo-updates-server`
- Certificados origen (Virtualmin): `/etc/ssl/virtualmin/1691420266222853/`
- Certificados destino (usuario app): `/home/otaupdates/ssl/`
- Hook post-renew script: `~/custom-ota-updates/expo-updates-server/deploy/supervisor/post-renew-certificates.sh`

---

## 1) Bootstrap inicial: copia manual de certificados (una sola vez)

- [ ] **Crear carpeta SSL de destino**
  - Comando:
    ```bash
    mkdir -p /home/otaupdates/ssl
    ```
  - Validación:
    ```bash
    test -d /home/otaupdates/ssl && echo OK
    ```
  - Éxito esperado: imprime `OK`.

- [ ] **Copiar certificados desde Virtualmin**
  - Comandos:
    ```bash
    cp /etc/ssl/virtualmin/1691420266222853/ssl.cert /home/otaupdates/ssl/
    cp /etc/ssl/virtualmin/1691420266222853/ssl.key  /home/otaupdates/ssl/
    cp /etc/ssl/virtualmin/1691420266222853/ssl.ca   /home/otaupdates/ssl/
    ```
  - Validación:
    ```bash
    ls -l /home/otaupdates/ssl/ssl.cert /home/otaupdates/ssl/ssl.key /home/otaupdates/ssl/ssl.ca
    ```
  - Éxito esperado: los 3 archivos existen.

- [ ] **Ajustar ownership y permisos**
  - Comandos:
    ```bash
    chown otaupdates:otaupdates /home/otaupdates/ssl/*
    chmod 600 /home/otaupdates/ssl/ssl.key
    chmod 644 /home/otaupdates/ssl/ssl.cert /home/otaupdates/ssl/ssl.ca
    ```
  - Validación:
    ```bash
    stat -c "%U:%G %a %n" /home/otaupdates/ssl/ssl.key /home/otaupdates/ssl/ssl.cert /home/otaupdates/ssl/ssl.ca
    ```
  - Éxito esperado:
    - `ssl.key` => `otaupdates:otaupdates 600`
    - `ssl.cert` y `ssl.ca` => `otaupdates:otaupdates 644`

---

## 2) Permiso de ejecución del hook post-renew

Este hook automatiza, en cada renovación, la misma secuencia del punto 1: copiar certs + permisos + reinicio de `updates-server`.

- [ ] **Dar permiso de ejecución al script**
  - Comando:
    ```bash
    chmod +x /home/otaupdates/custom-ota-updates/expo-updates-server/deploy/supervisor/post-renew-certificates.sh
    ```
  - Validación:
    ```bash
    test -x /home/otaupdates/custom-ota-updates/expo-updates-server/deploy/supervisor/post-renew-certificates.sh && echo OK
    ```
  - Éxito esperado: imprime `OK`.

- [ ] **Smoke test manual del hook**
  - Comando:
    ```bash
    /home/otaupdates/custom-ota-updates/expo-updates-server/deploy/supervisor/post-renew-certificates.sh
    ```
  - Validación:
    ```bash
    supervisorctl status updates-server
    ```
  - Éxito esperado: estado `RUNNING` (sin errores de permisos al copiar certs o reiniciar).

---

## 3) Registro del hook en renovación automática (certbot/Virtualmin)

- [ ] **Registrar hook post-renew**
  - Acción admin (una de estas dos rutas):
    - Virtualmin/Webmin: configurar “post-renew command” para ejecutar:
      ```bash
      /home/otaupdates/custom-ota-updates/expo-updates-server/deploy/supervisor/post-renew-certificates.sh
      ```
    - Certbot CLI (si aplica): agregar el script como hook en la configuración de renovación.
  - Validación:
    ```bash
    certbot renew --dry-run
    ```
  - Éxito esperado:
    - El `dry-run` finaliza sin error.
    - El hook se ejecuta (se ve en logs/resultado del dry-run).
    - `updates-server` queda `RUNNING` al final.

---

## 4) Configurar Supervisor para el servicio

- [ ] **Instalar/actualizar configuración de Supervisor**
  - Comando (ruta típica Debian/Ubuntu):
    ```bash
    cp /home/otaupdates/custom-ota-updates/expo-updates-server/deploy/supervisor/updates-server.conf /etc/supervisor/conf.d/updates-server.conf
    ```
  - Validación:
    ```bash
    test -f /etc/supervisor/conf.d/updates-server.conf && echo OK
    ```
  - Éxito esperado: imprime `OK`.

- [ ] **Recargar configuración e iniciar servicio**
  - Comandos:
    ```bash
    supervisorctl reread
    supervisorctl update
    supervisorctl start updates-server
    ```
  - Validación:
    ```bash
    supervisorctl status updates-server
    ```
  - Éxito esperado: `updates-server              RUNNING`.

- [ ] **Validar logs del proceso**
  - Comando:
    ```bash
    tail -n 100 /home/otaupdates/custom-ota-updates/expo-updates-server/logs/supervisor/error.log
    ```
  - Éxito esperado: sin errores de TLS, rutas SSL o variables faltantes.

---

## 5) Firewall / Red

- [ ] **Abrir TCP 3000 en firewall del VPS (Virtualmin/Webmin)**
  - Acción admin: habilitar tráfico entrante TCP `3000`.
  - Validación desde fuera del servidor:
    ```bash
    curl -I https://otaupdates.huayra.com.ar:3000
    ```
  - Éxito esperado: respuesta HTTPS (200/301/404 válido; lo importante es que responda por TLS).

- [ ] **Confirmar resolución DNS del subdominio**
  - Validación:
    ```bash
    nslookup otaupdates.huayra.com.ar
    ```
  - Éxito esperado: la IP resuelta coincide con la IP pública del VPS.

---

## 6) Validación final end-to-end (admin + app owner)

- [ ] **Health check de manifest OTA**
  - Comando:
    ```bash
    curl -k -I https://otaupdates.huayra.com.ar:3000/api/manifest
    ```
  - Éxito esperado: respuesta HTTP del endpoint (normalmente `200` o `400/404` según headers de cliente; lo importante es que el endpoint responda bajo TLS y no falle por SSL).

- [ ] **Verificar certificado servido por el puerto 3000**
  - Comando:
    ```bash
    openssl s_client -connect otaupdates.huayra.com.ar:3000 -servername otaupdates.huayra.com.ar </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
    ```
  - Éxito esperado:
    - `subject` contiene `otaupdates.huayra.com.ar` (o SAN válido)
    - fechas vigentes (`notBefore/notAfter` válidas)

- [ ] **Verificar estabilidad del proceso tras reinicio**
  - Comandos:
    ```bash
    supervisorctl restart updates-server
    sleep 3
    supervisorctl status updates-server
    ```
  - Éxito esperado: vuelve a `RUNNING` y mantiene estado estable.

---

## Criterio de cierre operativo

Se considera “listo en producción” cuando:

- [ ] Todos los checks de secciones 1 a 5 están en ✅
- [ ] `updates-server` permanece `RUNNING`
- [ ] `https://otaupdates.huayra.com.ar:3000/api/manifest` responde por HTTPS
- [ ] El `certbot renew --dry-run` ejecuta el hook sin romper el servicio
