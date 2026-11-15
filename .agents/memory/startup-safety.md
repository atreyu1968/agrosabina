---
name: Arranque y protección de datos
description: Criterio para elegir entre esperar a SQLite y trabajar con una copia local durante el arranque.
---

Mantener bloqueada la edición hasta que termine la selección y carga del almacén. Un aviso por lentitud no debe activar una copia local mientras SQLite siga pendiente.

**Why:** Se eligió esperar, en lugar de permitir edición provisional, porque una carga tardía puede sustituir las modificaciones recientes y no hay una política de conciliación entre ambas copias.

**How to apply:** En futuros cambios al arranque, habilitar edición solo después de completar la carga. Si se quiere permitir edición provisional, diseñar antes la cancelación o conciliación explícita de la carga pendiente.

Para Agrosabina instalable como PWA, CacheStorage debe contener únicamente recursos de la aplicación. No borrar ni sustituir la base local de SQLite/IndexedDB al instalar o actualizar el service worker.

**Why:** Los datos contables permanecen en el navegador; actualizar archivos de la PWA no equivale a migrar ni restaurar esos datos.

**How to apply:** Limitar el service worker a recursos estáticos y una copia del shell HTML. Cualquier migración del almacén local requiere un cambio explícito y no destructivo.
