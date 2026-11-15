# Hypotheses

## hyp_1 (Testing)

Reading exported .eml files is enough for the person's mailbox, without a server

Prediction: If true, a real .eml saved from the person's mail app opens in the Correo screen with the right sender, subject and an attachment that is read correctly.

Supporting: ev_0370c4e230445424c2ef82dc82faf43b3839caefd3e1250c754343508de56620

## hyp_2 (Testing)

Los acumulados de ventas se pueden calcular de las liquidaciones ya guardadas, sin tabla nueva en SQLite

Prediction: Si es cierto, una liquidación guardada antes de esta pantalla aparece sumada en kilos y líquido sin migrar la base ni volver a subir nada.

Supporting: ev_29ec50abba797e9b7ba4687377b8e278559f624232bafe44939886cf619ca500, ev_0ae5759a3ccc515c8ce2696b809987a974e45487ec28fd09b88ccf386322d1f5

## hyp_3 (Testing)

El lector nuevo lee bien las liquidaciones habituales: «0,853 €/kg» y «4.520 kg» salen con su valor, y cuando el papel no cuadra sale un aviso en vez de un número inventado.

Prediction: Si es cierto, al soltar una liquidación real (PDF o foto) en la vista previa el recuadro «Datos que voy a importar» enseña los kilos y el precio del papel, el bruto cuadra con kilos × precio y el líquido con bruto − descuentos; si el programa no ve el precio, lo dice en vez de poner un número raro.

Supporting: ev_c5d6f99d5295eb8c25fde6f45ee685edcae338250c876602df9b194752838f8c, ev_f915e1c96992092f3d57430d21f1c97898e073b7069f37db8cb2e103a595f932, ev_e68bfe00379b3b46861cb165e61d5f241377129995c5cbbfcfe3e1de9a07f018

## hyp_4 (Testing)

Marcar un documento como cobrado o pagado guarda la fecha y se ve después en la ficha y en las listas

Prediction: En la vista previa, pulsar «Pendiente» en una factura abre un cuadro con la fecha de hoy, y al guardar el estado pasa a «Pagado · dd/mm/aaaa» tanto en la lista como al abrir la ficha; al recargar la página la fecha sigue ahí.

Supporting: ev_c2e3b87b37807b4aeb889522d2060e1fcb3cdd91c29ea4a045df85ccabeb3137, ev_85dbcda622d196b403a64e864387a89e69882dd3de5e0ac554b0f4a4569ae9e1, ev_07c6b1b7a0c168ca01b1d999d34ee9ae1433cee3cc2850ebcd10b91634628e3b

## hyp_5 (Testing)

Lo que la persona llama «sigue igual» es una sección de Contabilidad que se abre pero sale sin asientos, porque el periodo por defecto (este año) no incluye sus documentos.

Prediction: Si es así, al preguntarle dirá que ve el menú y la sección con las pestañas, pero todo vacío o a cero; y al cambiar el periodo a «Todo lo registrado» aparecerían los asientos. Si en cambio dice «pantalla en blanco» o «vuelve a Resumen», esta hipótesis queda refutada y el problema es de carga/enrutado.

Supporting: ev_83dd978fa17c187555880dc3f4ef5a2295fd3379814d1f50b4889b9e9a5e939b

