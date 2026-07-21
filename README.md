# Númina — acceso rediseñado v2

## Rutas

- Portada pública: `https://elberlord.github.io/Numina/`
- Portal instalado / solicitud de dispositivo: `https://elberlord.github.io/Numina/portal.html`
- Panel administrativo: `https://elberlord.github.io/Numina/panel-privado-8f27c4.html`

La portada pública no contiene enlaces al panel administrativo. El nombre del archivo administrativo no es una medida de seguridad por sí sola porque el repositorio de GitHub es público. La protección real sigue siendo Firebase Authentication, el UID administrativo y las reglas de Firestore.

## Flujo público

1. La portada detecta si se abre desde PC o móvil y cambia el texto del botón.
2. El usuario instala Númina.
3. Aparece **Solicitar acceso para este dispositivo**.
4. Númina crea la solicitud en Firebase.
5. Se abre WhatsApp al número `+506 6430 5227` con el código del dispositivo.
6. El administrador aprueba o rechaza la solicitud desde su panel.

## Firebase

- Correo/Contraseña debe continuar activo para el administrador.
- Anónimo debe estar activo para las identidades iniciales de dispositivos.
- Las reglas de `firestore.rules` deben permanecer publicadas.
