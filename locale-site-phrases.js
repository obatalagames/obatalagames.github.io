/* Site-wide translation additions; loaded before the original i18n.js. */
(() => {
  'use strict';
  const phrases = {
    'categories.title': ['Trivia categories','Categorías de trivia','Catégories de quiz','Categorie di trivia','Κατηγορίες γνώσεων','Quiz-Kategorien','Kategorie kvízů','Kategorie quizu','Bilgi yarışması kategorileri','Категории викторин','问答类别','クイズのカテゴリー','فئات المسابقات'],
    'categories.questions': ['{{count}} questions','{{count}} preguntas','{{count}} questions','{{count}} domande','{{count}} ερωτήσεις','{{count}} Fragen','{{count}} otázek','{{count}} pytań','{{count}} soru','{{count}} вопросов','{{count}} 道题','{{count}} 問','{{count}} سؤالًا'],
    'categories.none': ['No playable categories available.','No hay categorías disponibles.','Aucune catégorie disponible.','Nessuna categoria disponibile.','Δεν υπάρχουν διαθέσιμες κατηγορίες.','Keine Kategorien verfügbar.','Nejsou k dispozici žádné kategorie.','Brak dostępnych kategorii.','Kullanılabilir kategori yok.','Нет доступных категорий.','暂无可玩的类别。','プレイ可能なカテゴリーはありません。','لا توجد فئات متاحة للعب.'],
    'categories.unavailable': ['Categories temporarily unavailable.','Categorías temporalmente no disponibles.','Catégories temporairement indisponibles.','Categorie temporaneamente non disponibili.','Οι κατηγορίες δεν είναι προσωρινά διαθέσιμες.','Kategorien vorübergehend nicht verfügbar.','Kategorie jsou dočasně nedostupné.','Kategorie są tymczasowo niedostępne.','Kategoriler geçici olarak kullanılamıyor.','Категории временно недоступны.','类别暂时不可用。','カテゴリーは一時的に利用できません。','الفئات غير متاحة مؤقتًا.'],
    'categories.loading': ['Loading categories…','Cargando categorías…','Chargement des catégories…','Caricamento delle categorie…','Φόρτωση κατηγοριών…','Kategorien werden geladen…','Načítání kategorií…','Ładowanie kategorii…','Kategoriler yükleniyor…','Загрузка категорий…','正在加载类别…','カテゴリーを読み込み中…','جارٍ تحميل الفئات…'],
    'category.us_football': ['US football',null,null,null,null,null,null,null,null,null,'美式橄榄球','アメリカンフットボール','كرة القدم الأمريكية'],
    'category.us_pop_culture': ['US pop culture',null,null,null,null,null,null,null,null,null,'美国流行文化','米国のポップカルチャー','الثقافة الشعبية الأمريكية'],
    'category.eu_soccer': ['EU soccer',null,null,null,null,null,null,null,null,null,'欧洲足球','欧州サッカー','كرة القدم الأوروبية'],
    'category.sa_soccer': ['South America soccer',null,null,null,null,null,null,null,null,null,'南美足球','南米サッカー','كرة القدم في أمريكا الجنوبية'],
    'category.combat_sports': ['Combat sports',null,null,null,null,null,null,null,null,null,'格斗运动','格闘技','الرياضات القتالية'],
    'category.music': ['Music',null,null,null,null,null,null,null,null,null,'音乐','音楽','الموسيقى'],
    'category.gaming': ['Gaming',null,null,null,null,null,null,null,null,null,'电子游戏','ゲーム','ألعاب الفيديو'],
    'category.film_tv': ['Film & TV',null,null,null,null,null,null,null,null,null,'电影与电视','映画・テレビ','الأفلام والتلفزيون'],
    'category.global_sports': ['Global sports',null,null,null,null,null,null,null,null,null,'全球体育','世界のスポーツ','الرياضة العالمية'],
    'category.mathematics': ['Mathematics',null,null,null,null,null,null,null,null,null,'数学','数学','الرياضيات'],
    'category.earth_science': ['Earth science',null,null,null,null,null,null,null,null,null,'地球科学','地球科学','علوم الأرض'],
    'category.spoken_language': ['Spoken language',null,null,null,null,null,null,null,null,null,'口语与语言','言語','اللغات المنطوقة'],
    'category.geopolitics': ['Geopolitics',null,null,null,null,null,null,null,null,null,'地缘政治','地政学','الجغرافيا السياسية'],
    'category.420': ['420',null,null,null,null,null,null,null,null,null,'420 文化','420カルチャー','ثقافة 420'],
    'category.wine_liquor': ['Wine & Liquor',null,null,null,null,null,null,null,null,null,'葡萄酒与烈酒','ワインと蒸留酒','النبيذ والمشروبات الروحية'],
    'category.japanese_history': ['Japanese History',null,null,null,null,null,null,null,null,null,'日本历史','日本史','التاريخ الياباني'],
    'category.chinese_history': ['Chinese History',null,null,null,null,null,null,null,null,null,'中国历史','中国史','التاريخ الصيني'],
    'category.soviet_history': ['Soviet History',null,null,null,null,null,null,null,null,null,'苏联历史','ソ連史','التاريخ السوفيتي'],
    'category.arab_history': ['Arab History',null,null,null,null,null,null,null,null,null,'阿拉伯历史','アラブ史','التاريخ العربي'],
    'admin.refresh': ['Refresh',null,null,null,null,null,null,null,null,null,'刷新','更新','تحديث'],
    'admin.all': ['All',null,null,null,null,null,null,null,null,null,'全部','すべて','الكل'],
    'admin.needsReview': ['Needs review',null,null,null,null,null,null,null,null,null,'待审核','要確認','تحتاج إلى مراجعة'],
    'admin.denied': ['Denied',null,null,null,null,null,null,null,null,null,'已拒绝','拒否','مرفوض'],
    'admin.allRequests': ['All requests',null,null,null,null,null,null,null,null,null,'所有请求','すべての申請','جميع الطلبات'],
    'admin.submitted': ['Submitted',null,null,null,null,null,null,null,null,null,'已提交','送信済み','تم الإرسال'],
    'admin.status.approved': ['Approved',null,null,null,null,null,null,null,null,null,'已批准','承認済み','تمت الموافقة'],
    'admin.status.paid': ['Paid',null,null,null,null,null,null,null,null,null,'已支付','支払済み','مدفوع'],
    'admin.status.under_review': ['Under review',null,null,null,null,null,null,null,null,null,'审核中','審査中','قيد المراجعة'],
    'admin.status.needs_info': ['Needs information',null,null,null,null,null,null,null,null,null,'需要补充资料','追加情報が必要','يلزم تقديم معلومات'],
    'admin.status.verified': ['Verified',null,null,null,null,null,null,null,null,null,'已验证','確認済み','تم التحقق'],
    'admin.status.rejected': ['Rejected',null,null,null,null,null,null,null,null,null,'已拒绝','却下','مرفوض'],
    'dashboard.missedTitle': ['Missed questions',null,null,null,null,null,null,null,null,null,'未答对的问题','間違えた問題','الأسئلة غير الصحيحة'],
    'dashboard.missedCopy': ['Questions you missed',null,null,null,null,null,null,null,null,null,'您未答对的题目','正解できなかった問題','الأسئلة التي لم تجب عنها بشكل صحيح'],
    'dashboard.missedLabel': ['Missed',null,null,null,null,null,null,null,null,null,'未答对','不正解','أخطاء'],
    'dashboard.skipped': ['Skipped',null,null,null,null,null,null,null,null,null,'已跳过','スキップ','تم التجاوز'],
  };
  const langs = ['en','es','fr','it','el','de','cs','pl','tr','ru','zh','ja','ar'];
  const result = Object.fromEntries(langs.map((code,idx) => [code,Object.fromEntries(Object.entries(phrases).filter(([_,values]) => values[idx]).map(([key,values]) => [key,values[idx]]))]));
  window.ChestPlayerSitePhrases = result;
})();
