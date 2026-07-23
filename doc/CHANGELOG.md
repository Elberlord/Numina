# Númina Serie v3.5.0

## Estabilidad y recuperación

- Recuperación visible si el arranque queda detenido.
- Reparación selectiva de caché y service worker sin tocar Firebase.
- Aviso cuando la misma instalación está abierta en varias pestañas.
- Bloqueo de guardados desde pestañas secundarias para evitar duplicados.
- Advertencia al cerrar mientras existen escrituras pendientes.
- Detección de sincronización atascada o con errores.
- Comprobación de almacenamiento persistente y cuota disponible.
- Revisión del service worker al regresar de segundo plano.
- Navegación offline con tiempo máximo de espera de red.
- Caché de actualización más resistente y limpieza limitada a Númina.

# Númina v3.4.0

- Importación JSON validada con vista previa, omisión de duplicados y registros inválidos.
- PIN nuevos de 6 a 8 dígitos con PBKDF2 y bloqueos progresivos; compatibilidad con PIN antiguos.
- Privacidad visual e impresión selectiva de datos sensibles.
- Aviso de actualización PWA, última sincronización y diagnóstico técnico.
- Registro local de errores sin datos personales y protección contra doble clic.
- Content Security Policy y eliminación del correo administrativo precargado.
- No requiere cambios en reglas de Firestore y no añade App Check.

# Númina v3.2.0

- Cada campaña puede configurarse **sin serie** o **con serie**.
- En campañas con serie, la venta exige número y serie.
- La exclusividad se valida por la combinación número + serie.
- Las coincidencias de campañas con serie comparan número y serie.
- Ventas, búsqueda, edición, panel, CSV y reportes muestran la serie.
- Las campañas existentes siguen funcionando como campañas sin serie.
- No requiere cambios en las reglas de Firestore.

# Númina v3.1.0

- Corrige la pantalla en blanco al pulsar “Ingresar clave temporal”.
- El formulario de activación ahora se muestra correctamente.
- Se actualizó la caché PWA para forzar la descarga del arreglo.

# Cambios — v3.0.0

- La aprobación directa fue sustituida por claves temporales de un solo uso.
- El usuario solicita una clave y recibe por WhatsApp una clave de 12 caracteres.
- La clave queda vinculada a la identidad anónima de esa instalación.
- Al usarla, el equipo se afilia y solicita crear un PIN local.
- El panel puede generar claves de activación o recuperación.
- Las claves vencen en 10, 30 o 60 minutos y no se guardan en texto visible.
- Se mantiene la revocación remota y el límite offline por dispositivo.
