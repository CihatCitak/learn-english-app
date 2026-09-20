# Learn English — PWA kabuğu

Kişisel İngilizce çalışma uygulamasının **kabuğu** (HTML/CSS/JS). İçinde veri yoktur; uygulama, ayarlar ekranına girilen fine-grained GitHub token ile veriyi özel repodan (`CihatCitak/Learn-English` → `app/data/*.json`) okur. Token yalnızca telefonda (localStorage) saklanır.

Kaynak ve veri üretimi: özel repodaki `app/` klasörü ve `tools/build_data.py`. Bu repo `tools/publish_app.py` ile oradan güncellenir.
