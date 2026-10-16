/*
 * generals.js — SG.Generals
 * 診断対象の戦国武将 20 人のデータ(データのみ。ロジック・DOM なし)。
 * 6 つの数値(leadership〜innovation)は診断用の仮想モデルであり、史実の性格を数値化したものではない。
 * reading は名前のひらがなの読み(姓+名)。図鑑の五十音順の並べ替えとふりがな表示だけに使い、診断には使わない。
 * 配列の順序は、類似度が完全に同じときの最終的な並び順(タイブレーク)として使う。
 * 史実の記述は一般的な通説の範囲にとどめ、逸話や諸説あるものは「〜と伝えられる」「〜とされる」で書く。
 * imageOfType は診断用の性格イメージで、必ず「診断では」で始めて史実の記述と区別する。
 */
(function (root) {
  'use strict';
  var SG = root.SG = root.SG || {};

  var generals = [
    {
      id: 'oda-nobunaga',
      name: '織田信長',
      reading: 'おだのぶなが',
      title: '革新を恐れない革命児',
      description: '尾張から勢力を広げ、天下統一を目指した戦国武将。',
      leadership: 61, action: 56, strategy: 50, social: 31, caution: 34, innovation: 67,
      image: null,
      imageCredit: null,
      lifespan: '1534年〜1582年',
      region: '尾張(愛知県)・美濃・近江・京都',
      achievements: [
        '桶狭間の戦い(1560年)で今川義元を破った',
        '長篠の戦い(1575年)で、鉄砲を大規模に用いたとされる',
        '安土城を築いた'
      ],
      events: ['本能寺の変(1582年)で、家臣の明智光秀に討たれた'],
      imageOfType: '診断では、新しい発想と決断の速さが際立つタイプとして描いています。前例にとらわれず、大胆に物事を動かす人がこの武将に近くなります。',
      reason: { history: '織田信長は、従来のやり方にこだわらず新しい戦い方を取り入れた人物として知られています。' },
      crest: { kind: 'petals5', pattern: 'seigaiha', bg1: '#7a1020', bg2: '#1a0509', accent: '#f0c75e', glyph: null, display: '信長' }
    },
    {
      id: 'toyotomi-hideyoshi',
      name: '豊臣秀吉',
      reading: 'とよとみひでよし',
      title: '人の心をつかむ人たらし',
      description: '低い身分から身を起こし、関白・太閤にまで上りつめて全国統一を果たした武将。',
      leadership: 50, action: 53, strategy: 46, social: 67, caution: 42, innovation: 51,
      image: null,
      imageCredit: null,
      lifespan: '1537年〜1598年(1536年説あり)',
      region: '尾張(愛知県)・近江・大坂',
      achievements: [
        '山崎の戦い(1582年)で明智光秀を破った',
        '大坂城を築いた',
        '小田原征伐(1590年)を経て全国統一を果たした'
      ],
      events: ['太閤検地や刀狩を行った', '低い身分から関白・太閤にまで上りつめた'],
      imageOfType: '診断では、人との関係づくりがうまく、状況に合わせて柔軟に動けるタイプとして描いています。周りを味方にしながら道を切り開く人がこの武将に近くなります。',
      reason: { history: '豊臣秀吉は、低い身分から天下人にまで上りつめた人物として知られています。' },
      crest: { kind: 'sun', pattern: 'shippo', bg1: '#8a6414', bg2: '#241803', accent: '#ffe08a', glyph: null, display: '秀吉' }
    },
    {
      id: 'tokugawa-ieyasu',
      name: '徳川家康',
      reading: 'とくがわいえやす',
      title: 'じっくり待つ不動の大器',
      description: '長い忍耐の末に天下を治め、江戸幕府を開いた武将。',
      // 設計書の値は 社交 47・慎重 72。集団バイアス検査(#16)の余裕を取るため 社交 −2・慎重 +1 に調整(plan.md 1.2)
      leadership: 59, action: 37, strategy: 56, social: 45, caution: 73, innovation: 34,
      image: null,
      imageCredit: null,
      lifespan: '1543年〜1616年',
      region: '三河(愛知県)・駿府(静岡県)・江戸(東京都)',
      achievements: [
        '関ヶ原の戦い(1600年)に勝利した',
        '1603年に征夷大将軍となり、江戸幕府を開いた'
      ],
      events: ['幼少期を今川氏・織田氏のもとで過ごした', '大坂の陣(1614〜1615年)で豊臣氏を滅ぼした'],
      imageOfType: '診断では、先を見通してじっくり待てる、安定志向のタイプとして描いています。リスクを避けながら着実に積み重ねる人がこの武将に近くなります。',
      reason: { history: '徳川家康は、幼いころから苦労を重ね、長い年月をかけて天下を手にした人物として知られています。' },
      crest: { kind: 'trefoil', pattern: 'kikkou', bg1: '#124b36', bg2: '#04140d', accent: '#d8c785', glyph: null, display: '家康' }
    },
    {
      id: 'takeda-shingen',
      name: '武田信玄',
      reading: 'たけだしんげん',
      title: '組織を動かす戦略の総大将',
      description: '甲斐を本拠に強力な軍団を率い、周辺の国々へ勢力を広げた武将。',
      leadership: 72, action: 45, strategy: 54, social: 38, caution: 52, innovation: 33,
      image: null,
      imageCredit: null,
      lifespan: '1521年〜1573年',
      region: '甲斐(山梨県)・信濃(長野県)・駿河',
      achievements: [
        '分国法「甲州法度之次第」を定めた',
        '三方ヶ原の戦い(1572年)で徳川・織田の連合軍を破った',
        '治水のための堤(信玄堤)を築いたと伝えられる'
      ],
      events: ['川中島で上杉謙信とたびたび対峙した', '西へ向かう途中で病のため亡くなった'],
      imageOfType: '診断では、組織をまとめ、計画的に物事を進めるリーダータイプとして描いています。全体を見渡して人を動かす人がこの武将に近くなります。',
      reason: { history: '武田信玄は、甲斐の国を治めながら強い軍団を率い、周辺へ勢力を広げた人物として知られています。' },
      crest: { kind: 'diamonds4', pattern: 'uroko', bg1: '#6b1018', bg2: '#1d0508', accent: '#e9b84f', glyph: null, display: '信玄' }
    },
    {
      id: 'uesugi-kenshin',
      name: '上杉謙信',
      reading: 'うえすぎけんしん',
      title: '信念を貫く義の戦士',
      description: '越後を治め、義を重んじたと語られる武将。',
      leadership: 61, action: 67, strategy: 35, social: 24, caution: 49, innovation: 49,
      image: null,
      imageCredit: null,
      lifespan: '1530年〜1578年',
      region: '越後(新潟県)・関東・北陸',
      achievements: [
        '長尾景虎として越後を継いだ',
        '1561年に関東管領職と上杉の姓を継いだ'
      ],
      events: ['川中島で武田信玄と戦った', '毘沙門天を厚く信仰したと伝えられる'],
      imageOfType: '診断では、自分の信念に従って迷わず動く、筋を通すタイプとして描いています。決めたことをまっすぐやり抜く人がこの武将に近くなります。',
      reason: { history: '上杉謙信は、毘沙門天を厚く信仰し、義を重んじて戦ったと伝えられます。' },
      crest: { kind: 'stripes3', pattern: 'ichimatsu', bg1: '#1c2f66', bg2: '#080d22', accent: '#e8e4d0', glyph: null, display: '謙信' }
    },
    {
      id: 'date-masamune',
      name: '伊達政宗',
      reading: 'だてまさむね',
      title: '野心あふれる個性派リーダー',
      description: '東北で勢力を広げ、仙台藩の初代藩主となった武将。',
      leadership: 58, action: 59, strategy: 48, social: 39, caution: 30, innovation: 65,
      image: null,
      imageCredit: null,
      lifespan: '1567年〜1636年',
      region: '出羽・陸奥(山形県米沢・宮城県仙台)',
      achievements: [
        '摺上原の戦い(1589年)で蘆名氏を破った',
        '仙台城を築き、仙台藩の初代藩主となった'
      ],
      events: ['支倉常長らの慶長遣欧使節(1613年)を派遣した', '隻眼であったことから、のちに「独眼竜」と呼ばれるようになった'],
      imageOfType: '診断では、大きな野心と強い個性で挑戦を続けるタイプとして描いています。自分らしさを武器に新しいことへ踏み出す人がこの武将に近くなります。',
      reason: { history: '伊達政宗は、遠くヨーロッパへ使節を送るなど、大きな構想を持っていた人物として知られています。' },
      crest: { kind: 'crescent', pattern: 'asanoha', bg1: '#14183a', bg2: '#050612', accent: '#f2d572', glyph: null, display: '政宗' }
    },
    {
      id: 'sanada-yukimura',
      name: '真田幸村（信繁）',
      reading: 'さなだゆきむら',
      title: '逆境に燃える不屈の勇者',
      description: '大坂の陣で豊臣方として奮戦した武将で、本名は真田信繁。',
      leadership: 53, action: 69, strategy: 45, social: 42, caution: 34, innovation: 59,
      image: null,
      imageCredit: null,
      lifespan: '1567年〜1615年(1570年説あり)',
      region: '信濃上田(長野県)・九度山(和歌山県)・大坂',
      achievements: [
        '大坂冬の陣で出城「真田丸」を築き、徳川軍を苦しめた',
        '大坂夏の陣(1615年)で、徳川家康の本陣に迫ったと伝えられる'
      ],
      events: ['関ヶ原の戦いのあと、九度山で長く暮らした', '本名は信繁で、「幸村」は後世に広まった呼び名とされる'],
      imageOfType: '診断では、逆境でも勇気を持って挑み続けるタイプとして描いています。不利な状況ほど燃える人がこの武将に近くなります。',
      reason: { history: '真田幸村は、大坂の陣で劣勢の中でも最後まで奮戦した人物として知られています。' },
      crest: { kind: 'coins6', pattern: 'seigaiha', bg1: '#8b1a1a', bg2: '#120505', accent: '#f0c75e', glyph: null, display: '幸村' }
    },
    {
      id: 'mori-motonari',
      name: '毛利元就',
      reading: 'もうりもとなり',
      title: '知略で道を切り開く策士',
      description: '安芸の小さな領主から、中国地方の大半を支配するまでになった武将。',
      leadership: 48, action: 31, strategy: 65, social: 45, caution: 67, innovation: 46,
      image: null,
      imageCredit: null,
      lifespan: '1497年〜1571年',
      region: '安芸(広島県)・中国地方',
      achievements: [
        '厳島の戦い(1555年)で陶晴賢を破った',
        '尼子氏を滅ぼし(1566年)、中国地方の大半を支配した'
      ],
      events: ['子らに結束を説いた書状(三子教訓状)が残っている', '「三本の矢」の話は後世の逸話とされる'],
      imageOfType: '診断では、よく考えて慎重に手を打つ、戦略家タイプとして描いています。準備を重ねてから確実に動く人がこの武将に近くなります。',
      reason: { history: '毛利元就は、子どもたちに一族の結束を説いた書状を残したことでも知られています。' },
      crest: { kind: 'stars3', pattern: 'shippo', bg1: '#0f5a5a', bg2: '#031717', accent: '#e6d28a', glyph: null, display: '元就' }
    },
    {
      id: 'akechi-mitsuhide',
      name: '明智光秀',
      reading: 'あけちみつひで',
      title: '冷静沈着な理知の参謀',
      description: '織田信長に仕えて活躍し、のちに本能寺の変を起こした武将。',
      leadership: 46, action: 28, strategy: 63, social: 27, caution: 63, innovation: 48,
      image: null,
      imageCredit: null,
      lifespan: '生年不詳(諸説あり)〜1582年',
      region: '美濃(岐阜県)・近江坂本(滋賀県)・丹波(京都府)',
      achievements: [
        '坂本城や亀山城を築いた',
        '丹波の平定に力を尽くした'
      ],
      events: ['本能寺の変(1582年)で織田信長を討った(動機には諸説ある)', '山崎の戦いで羽柴秀吉に敗れ、その後亡くなった'],
      imageOfType: '診断では、物事を論理的に分析し、計画を立てて進める理知的なタイプとして描いています。冷静に考え抜いてから動く人がこの武将に近くなります。',
      reason: { history: '明智光秀は、教養が深く、城づくりや領地の統治にも力を発揮した人物とされます。' },
      crest: { kind: 'tomoe3', pattern: 'asanoha', bg1: '#4a2a70', bg2: '#10081c', accent: '#e8c45a', glyph: null, display: '光秀' }
    },
    {
      id: 'ishida-mitsunari',
      name: '石田三成',
      reading: 'いしだみつなり',
      title: 'ルールと忠義を重んじる理論派',
      description: '豊臣政権を実務の面から支えた武将。',
      leadership: 51, action: 43, strategy: 63, social: 19, caution: 61, innovation: 33,
      image: null,
      imageCredit: null,
      lifespan: '1560年〜1600年',
      region: '近江(滋賀県)・大坂',
      achievements: [
        '豊臣政権の五奉行の一人となった',
        '検地など、政権の実務を担った'
      ],
      events: ['関ヶ原の戦い(1600年)で西軍の中心となって敗れ、処刑された'],
      imageOfType: '診断では、ルールと筋道を大切にし、論理的に物事を進めるタイプとして描いています。決まりを守り、責任を持ってやり遂げる人がこの武将に近くなります。',
      reason: { history: '石田三成は、豊臣政権で検地などの実務を担った有能な官僚として知られています。' },
      crest: { kind: 'arrows', pattern: 'ichimatsu', bg1: '#2b3f5c', bg2: '#0a1018', accent: '#d9d2b0', glyph: null, display: '三成' }
    },
    {
      id: 'kuroda-kanbei',
      name: '黒田官兵衛',
      reading: 'くろだかんべえ',
      title: '先を読む天才軍師',
      description: '羽柴秀吉の参謀として活躍した武将。',
      leadership: 37, action: 49, strategy: 66, social: 40, caution: 45, innovation: 66,
      image: null,
      imageCredit: null,
      lifespan: '1546年〜1604年',
      region: '播磨(兵庫県)・豊前・筑前(福岡県)',
      achievements: [
        '羽柴秀吉の参謀として中国攻めを支えた',
        'キリシタン大名となった(洗礼名シメオン)'
      ],
      events: ['荒木村重に捕らえられ、幽閉された(1578〜1579年)', '本能寺の変のあと、秀吉に中国大返しを助言したと伝えられる'],
      imageOfType: '診断では、先を読んで柔軟に策を考える、軍師タイプとして描いています。状況を分析して新しい手を打てる人がこの武将に近くなります。',
      reason: { history: '黒田官兵衛は、秀吉のそばで先を読んだ策を示した軍師として知られています。' },
      crest: { kind: 'waves', pattern: 'uroko', bg1: '#3a5a2a', bg2: '#0c1608', accent: '#e8d68a', glyph: null, display: '官兵衛' }
    },
    {
      id: 'takenaka-hanbei',
      name: '竹中半兵衛',
      reading: 'たけなかはんべえ',
      title: '静かに勝利を描く名参謀',
      description: '羽柴秀吉の参謀として知られる美濃出身の武将。',
      leadership: 37, action: 30, strategy: 67, social: 30, caution: 61, innovation: 53,
      image: null,
      imageCredit: null,
      lifespan: '1544年〜1579年',
      region: '美濃(岐阜県)・近江・播磨',
      achievements: [
        '少人数で稲葉山城を奪ったとされる(1564年)',
        'のちに羽柴秀吉の参謀となった'
      ],
      events: ['播磨の三木城攻めの陣中で、病のため亡くなった'],
      imageOfType: '診断では、静かに状況を見極め、勝ち筋を描くタイプとして描いています。表に出すぎず、冷静に計画を練る人がこの武将に近くなります。',
      reason: { history: '竹中半兵衛は、わずかな人数で稲葉山城を奪ったとされます。' },
      crest: { kind: 'mountain3', pattern: 'seigaiha', bg1: '#2f4f6f', bg2: '#0b141d', accent: '#cfe0e8', glyph: null, display: '半兵衛' }
    },
    {
      id: 'honda-tadakatsu',
      name: '本多忠勝',
      reading: 'ほんだただかつ',
      title: 'どんな時も前に出る猛将',
      description: '徳川家康に仕え、数多くの合戦で活躍した武将。',
      leadership: 55, action: 63, strategy: 24, social: 42, caution: 36, innovation: 28,
      image: null,
      imageCredit: null,
      lifespan: '1548年〜1610年',
      region: '三河(愛知県)・伊勢桑名(三重県)・上総大多喜(千葉県)',
      achievements: [
        '徳川四天王の一人に数えられる',
        '姉川・長篠・小牧長久手などの戦いで活躍した'
      ],
      events: ['愛用の槍は「蜻蛉切」と呼ばれる', '多くの合戦に出ながら、大きな傷を負わなかったと伝えられる'],
      imageOfType: '診断では、迷わず前に出て、やるべきことを実行するタイプとして描いています。仲間のために体を張れる人がこの武将に近くなります。',
      reason: { history: '本多忠勝は、数多くの合戦に出ながら、ほとんど傷を負わなかったと伝えられます。' },
      crest: { kind: 'arrows', pattern: 'kikkou', bg1: '#3b3b3b', bg2: '#0a0a0a', accent: '#e8c45a', glyph: null, display: '忠勝' }
    },
    {
      id: 'maeda-toshiie',
      name: '前田利家',
      reading: 'まえだとしいえ',
      title: '頼れる兄貴分',
      description: '織田信長・豊臣秀吉に仕え、加賀藩前田家の基礎を築いた武将。',
      leadership: 53, action: 62, strategy: 37, social: 58, caution: 51, innovation: 34,
      image: null,
      imageCredit: null,
      lifespan: '1538年〜1599年(1539年説あり)',
      region: '尾張(愛知県)・越前・能登・加賀(石川県)',
      achievements: [
        '豊臣政権の五大老の一人となった',
        '金沢を拠点に、加賀藩前田家の基礎を築いた'
      ],
      events: ['賤ヶ岳の戦い(1583年)に加わった', '槍の名手で「槍の又左」と呼ばれた'],
      imageOfType: '診断では、面倒見がよく、仲間との信頼を大切にしながら動くタイプとして描いています。頼られると力を発揮する人がこの武将に近くなります。',
      reason: { history: '前田利家は、若いころから槍の名手として「槍の又左」と呼ばれたことで知られています。' },
      crest: { kind: 'petals5', pattern: 'ichimatsu', bg1: '#5a3a1a', bg2: '#1a0f06', accent: '#f0c75e', glyph: null, display: '利家' }
    },
    {
      id: 'kato-kiyomasa',
      name: '加藤清正',
      reading: 'かとうきよまさ',
      title: '責任感あふれる実直な行動派',
      description: '豊臣秀吉に仕え、のちに肥後を治めて熊本城を築いた武将。',
      leadership: 55, action: 68, strategy: 26, social: 33, caution: 44, innovation: 33,
      image: null,
      imageCredit: null,
      lifespan: '1562年〜1611年',
      region: '尾張(愛知県)・肥後(熊本県)',
      achievements: [
        '熊本城を築いた',
        '治水や土木の事業にも取り組んだ'
      ],
      events: ['賤ヶ岳の七本槍の一人に数えられる', '文禄・慶長の役に出陣した'],
      imageOfType: '診断では、責任感が強く、やるべきことを確実に実行するタイプとして描いています。行動で信頼を勝ち取る人がこの武将に近くなります。',
      reason: { history: '加藤清正は、熊本城を築き、治水や土木の事業にも力を注いだことで知られています。' },
      crest: { kind: 'rings', pattern: 'uroko', bg1: '#8a2a10', bg2: '#1f0a04', accent: '#f5d76e', glyph: null, display: '清正' }
    },
    {
      id: 'shimazu-yoshihiro',
      name: '島津義弘',
      reading: 'しまづよしひろ',
      title: '迷わず突き進む豪胆な統率者',
      description: '九州南部を本拠とする島津家の武将で、各地の合戦で活躍した人物。',
      leadership: 67, action: 62, strategy: 42, social: 42, caution: 30, innovation: 45,
      image: null,
      imageCredit: null,
      lifespan: '1535年〜1619年',
      region: '薩摩・大隅(鹿児島県)・日向(宮崎県)',
      achievements: [
        '木崎原の戦い(1572年)で勝利した',
        '朝鮮出兵の泗川の戦い(1598年)で、明・朝鮮軍を退けたとされる'
      ],
      events: ['関ヶ原の戦い(1600年)で敵中を突破して退いた(島津の退き口)', '敵から「鬼石曼子」と恐れられたと伝えられる'],
      imageOfType: '診断では、決断が早く、仲間を率いて突き進む豪胆なタイプとして描いています。いざという時に腹をくくれる人がこの武将に近くなります。',
      reason: { history: '島津義弘は、関ヶ原の戦いで敵の中を突き抜けて退いたことで知られています。' },
      crest: { kind: 'crossring', pattern: 'shippo', bg1: '#1a3a5a', bg2: '#060f1a', accent: '#e8e0c0', glyph: null, display: '義弘' }
    },
    {
      id: 'hojo-ujiyasu',
      name: '北条氏康',
      reading: 'ほうじょううじやす',
      title: '堅実に国を治める名君',
      description: '小田原を本拠に関東で勢力を広げ、領国の統治に力を入れた武将。',
      leadership: 65, action: 35, strategy: 56, social: 46, caution: 69, innovation: 29,
      image: null,
      imageCredit: null,
      lifespan: '1515年〜1571年',
      region: '相模・武蔵(神奈川県小田原ほか)',
      achievements: [
        '河越夜戦(1546年)に勝利した(後世の脚色も指摘されている)',
        '検地や税制の整備など、領国の統治に力を入れた'
      ],
      events: ['武田氏・今川氏と甲相駿三国同盟を結んだ(1554年ごろ)'],
      imageOfType: '診断では、足元を固めて着実に国を治める、堅実なタイプとして描いています。仕組みを整え、無理をせず成果を積み上げる人がこの武将に近くなります。',
      reason: { history: '北条氏康は、検地や税制を整え、領国をよく治めた人物として知られています。' },
      crest: { kind: 'scales3', pattern: 'seigaiha', bg1: '#3a3a6a', bg2: '#0d0d1f', accent: '#e5d28a', glyph: null, display: '氏康' }
    },
    {
      id: 'chosokabe-motochika',
      name: '長宗我部元親',
      reading: 'ちょうそかべもとちか',
      title: '大志を抱く挑戦者',
      description: '土佐を統一し、四国の大半に勢力を広げた武将。',
      leadership: 64, action: 63, strategy: 44, social: 32, caution: 38, innovation: 60,
      image: null,
      imageCredit: null,
      lifespan: '1539年〜1599年',
      region: '土佐(高知県)・四国',
      achievements: [
        '土佐を統一した(1575年ごろ)',
        '四国の大半に勢力を広げた'
      ],
      events: ['豊臣秀吉の四国攻め(1585年)で降伏した', '半農半兵の「一領具足」で知られる'],
      imageOfType: '診断では、大きな目標を掲げ、仲間を率いて挑戦するタイプとして描いています。小さな場所から大きく打って出る人がこの武将に近くなります。',
      reason: { history: '長宗我部元親は、半農半兵の「一領具足」を用いて、土佐から四国へ勢力を広げたことで知られています。' },
      crest: { kind: 'petals8', pattern: 'asanoha', bg1: '#0f4f7a', bg2: '#041420', accent: '#f0e0a0', glyph: null, display: '元親' }
    },
    {
      id: 'naoe-kanetsugu',
      name: '直江兼続',
      reading: 'なおえかねつぐ',
      title: '義と知を兼ね備えた名宰相',
      description: '主君の上杉景勝を支えた上杉家の重臣。',
      leadership: 57, action: 49, strategy: 58, social: 47, caution: 61, innovation: 30,
      image: null,
      imageCredit: null,
      lifespan: '1560年〜1620年',
      region: '越後(新潟県)・出羽米沢(山形県)',
      achievements: [
        '上杉景勝を重臣として支えた',
        '米沢藩の財政の立て直しや治水(直江石堤)に取り組んだ'
      ],
      events: ['兜の前立てに「愛」の字を用いたと伝わる(由来には諸説ある)'],
      imageOfType: '診断では、筋を通しながら知恵を働かせ、責任をもって組織を支えるタイプとして描いています。主役を支える頼れる参謀役の人がこの武将に近くなります。',
      reason: { history: '直江兼続は、兜の前立てに「愛」の字を掲げたと伝えられます。' },
      crest: { kind: 'glyph', pattern: 'kikkou', bg1: '#7a1a3a', bg2: '#1a0510', accent: '#f2d572', glyph: '愛', display: '兼続' }
    },
    {
      id: 'tachibana-muneshige',
      name: '立花宗茂',
      reading: 'たちばなむねしげ',
      title: '誠実で折れない大将',
      description: '九州で活躍し、一度は領地を失いながらも旧領に復帰した武将。',
      leadership: 63, action: 61, strategy: 33, social: 53, caution: 48, innovation: 32,
      image: null,
      imageCredit: null,
      lifespan: '1567年〜1643年',
      region: '筑前・筑後柳川(福岡県)',
      achievements: [
        '朝鮮出兵(碧蹄館の戦いなど)で活躍した',
        '関ヶ原の戦いのあとに領地を失ったが、のちに旧領の柳川に復帰した'
      ],
      events: ['高橋紹運の子として生まれ、立花道雪の婿養子となった'],
      imageOfType: '診断では、誠実さと勇気で仲間を引っ張る、折れないリーダータイプとして描いています。信頼を積み重ね、逆境から立ち直れる人がこの武将に近くなります。',
      reason: { history: '立花宗茂は、関ヶ原の戦いのあと領地を失いながらも、のちに旧領の柳川へ戻った人物として知られています。' },
      crest: { kind: 'stripes3', pattern: 'shippo', bg1: '#4a5a1a', bg2: '#10140a', accent: '#e8d98a', glyph: null, display: '宗茂' }
    }
  ];

  // データを深く凍結する(実行中にパラメータや文章が書き換わらないことを保証する)
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
    return o;
  }

  SG.Generals = deepFreeze(generals);
  if (typeof module !== 'undefined' && module.exports) { module.exports = SG.Generals; }
})(typeof window !== 'undefined' ? window : globalThis);
