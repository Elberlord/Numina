# Númina v3.2 — Campañas con o sin serie

Esta versión conserva el acceso por clave temporal y añade modalidad por campaña.

## Modalidades

- **Sin serie:** cada registro utiliza solo un número.
- **Con serie:** cada registro exige número y serie. La serie conserva ceros iniciales y admite letras, por ejemplo `007` o `A12`.

En campañas con serie, los registros exclusivos y las coincidencias se evalúan usando la combinación exacta **número + serie**. Las campañas creadas antes de esta actualización se interpretan automáticamente como **sin serie**.

## Actualización

1. Copia todos los archivos a la raíz del repositorio `Numina`.
2. No borres la carpeta `.git`.
3. Haz commit y push.
4. Cierra y vuelve a abrir la PWA para descargar la nueva caché.

No es necesario modificar las reglas de Firestore para esta versión.

---

# Númina — Activación con clave temporal v3

## Flujo

1. El usuario instala o abre Númina.
2. Solicita una clave y envía el mensaje por WhatsApp.
3. El administrador abre el panel privado, localiza la solicitud y pulsa **Generar clave**.
4. Envía la clave por WhatsApp.
5. El usuario pulsa **Ingresar clave temporal**, activa el equipo y crea su PIN.
6. El equipo entra normalmente con ese PIN hasta ser revocado o vencer su permiso offline.

## Recuperación

En un dispositivo activo, el administrador puede pulsar **Nueva clave**. Esa clave permite borrar el PIN local y crear uno nuevo, sin duplicar el dispositivo. Si el navegador fue borrado o reinstalado y cambió el UID anónimo, debe enviarse una solicitud nueva y revocarse la instalación anterior.

## Publicación

- Copia todos los archivos a la raíz del repositorio sin borrar `.git`.
- Publica `firestore.rules` manualmente en Firebase Console → Firestore → Reglas.
- Haz commit y push.
- Después de publicar, fuerza actualización o reinstala la PWA para reemplazar la caché anterior.

## Seguridad

- Las claves son de un solo uso y expiran.
- Firestore guarda solamente el SHA-256 de la clave, no el texto enviado.
- Cada clave está vinculada a un UID anónimo concreto.
- Solo el UID administrativo puede crear claves, listar dispositivos, revocar o reactivar.
