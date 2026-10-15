# Credits / Авторы ассетов

Все сторонние ассеты — только лицензии **CC0** или **CC BY**. Ниже — каждый файл, автор и лицензия.

## Текстуры (Poly Haven, CC0 1.0)

| Файл в проекте | Ассет | Авторы | Лицензия | Источник |
|---|---|---|---|---|
| `assets/textures/gravelly_sand/` (diff 2k, nor_gl и arm 1k) — песок участка | Gravelly Sand | Dario Barresi | CC0 | https://polyhaven.com/a/gravelly_sand |
| `assets/textures/excavated_soil_wall/` (1k) | Excavated Soil Wall | Amal Kumar | CC0 | https://polyhaven.com/a/excavated_soil_wall |
| `assets/textures/wood_table_worn/` (1k) | Wood Table Worn | Dimitrios Savva (фото), Rico Cilliers (обработка) | CC0 | https://polyhaven.com/a/wood_table_worn |
| `assets/textures/plywood/` (1k) — фанера (дно, отвалы) | Plywood | Rob Tuytel | CC0 | https://polyhaven.com/a/plywood |
| `assets/textures/raw_plank_wall/` (1k) — доски опалубки | Raw Plank Wall | Dimitrios Savva | CC0 | https://polyhaven.com/a/raw_plank_wall |
| `assets/textures/forest_ground_06/` (1k) — пятна тёмного суглинка на участке | Forest Ground 06 | Charlotte Baglioni | CC0 | https://polyhaven.com/a/forest_ground_06 |
| `assets/textures/dense_sand/` (diff, nor_gl 1k) — песок (материал) | Dense Sand | Dimitrios Savva | CC0 | https://polyhaven.com/a/dense_sand |
| `assets/textures/gravel_floor_02/` (diff, nor_gl 1k) — щебень 5–20 и 20–40 (одно фото в двух масштабах, затемнено до серого гранита) | Gravel Floor 02 | Dimitrios Savva (фото), Jenelle van Heerden (обработка) | CC0 | https://polyhaven.com/a/gravel_floor_02 |

## HDRI (Poly Haven, CC0 1.0)

| Файл | Ассет | Автор | Лицензия | Источник |
|---|---|---|---|---|
| `assets/hdri/carpentry_shop_02_1k.hdr` | Carpentry Shop 02 | Greg Zaal | CC0 | https://polyhaven.com/a/carpentry_shop_02 |
| `assets/hdri/construction_yard_2k.hdr` — панорама стройплощадки 360° | Construction Yard | Sergej Majboroda | CC0 | https://polyhaven.com/a/construction_yard |

## 3D-модели техники (Sketchfab, CC BY 4.0)

Модели взяты из открытого набора Objaverse (только файлы с лицензией CC BY 4.0) и **изменены**: оптимизированы
glTF-Transform (текстуры WebP ≤ 512 px, геометрия meshopt), приведены к масштабу 1:12; у КАМАЗа скрыт кузов-тент,
вместо него кодом добавлены барабан миксера, лоток, бак, лестница и рама; к трактору кодом добавлен фронтальный погрузчик;
у экскаватора детали стрелы, рукояти и ковша управляются кинематикой игры.

| Файл | Модель | Автор | Лицензия | Источник |
|---|---|---|---|---|
| `assets/models/excavator.glb` | Excavator animation | tori1243 | CC BY 4.0 | https://sketchfab.com/3d-models/940258497f9f4eba9710bb359a9e777e |
| `assets/models/kamaz.glb` — шасси автобетоносмесителя | KAMAZ 5330 | davidbroutian | CC BY 4.0 | https://sketchfab.com/3d-models/e86a62f4b8c84e03b2c6e32c51474bc7 |
| `assets/models/tractor.glb` | Tractor | le0tard | CC BY 4.0 | https://sketchfab.com/3d-models/278fc1e0516c401eba358d3aa2e55635 |
| `assets/models/concrete-pump.glb` | Concrete pump | rhymone | CC BY 4.0 | https://sketchfab.com/3d-models/8e883fffc1b14e089304c41c5d9b484a |
| `assets/models/site-mixer.glb` | Hormigonera | rafarelo | CC BY 4.0 | https://sketchfab.com/3d-models/7eb177b8abec4735b6644d74bb10ba82 |

## Фото-задники

| Файл | Источник |
|---|---|
| `assets/backdrops/site-billboard.jpg`, `assets/backdrops/site-crane.jpg` | Изображения предоставлены автором канала Tiny Craftsman для использования в игре |

## Код

| Компонент | Автор | Лицензия |
|---|---|---|
| three.js r180 (`vendor/three/`, включая `addons/loaders/HDRLoader.js`, `addons/loaders/GLTFLoader.js`, `addons/utils/BufferGeometryUtils.js`) | three.js authors | MIT (`vendor/three/LICENSE`) |
| meshoptimizer decoder (`vendor/three/addons/libs/meshopt_decoder.module.js`) | Arseny Kapoulkine | MIT |

## Сгенерировано процедурно (наше, без внешних источников)

Лопаты, колышки, ламинат бортиков коробки и серая столешница (текстуры рисуются кодом), шнур-причалка, линейка (шкала нарисована кодом), карандаш, статическая трава,
комья грунта, пылинки, звуки (синтез шума WebAudio), иконки приложения; фронтальный погрузчик трактора (рамы, ковш,
гидроцилиндры), барабан автобетоносмесителя со спиралью и полосами, лоток, бак, лестница; арматура периодического
профиля (карта нормалей рисуется кодом), пластиковые стульчики, «лягушки», вязальная проволока, кладочная сетка.
