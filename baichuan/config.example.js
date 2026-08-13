// 學長姐資料範本。正式資料不進 git：
// 本機測試 → 複製成 config.js 填入真資料（.gitignore 已擋 **/config.js）
// 正式站 → deploy workflow 從 GitHub Secret BAICHUAN_SENIORS 產生 config.js，secret 內容是下面陣列的 JSON
// no = 「118 級學長姐填寫區」試算表的列序，同時是學弟妹表單上的固定編號，兩邊要一致
window.BAICHUAN_SENIORS = [
    { "no": 1, "core": "資訊工程", "mbti": "INTP", "lines": ["自我介紹第一行", "自我介紹第二行"] },
    { "no": 2, "core": "法律", "mbti": "", "lines": ["MBTI 留空就不顯示標籤"] }
];
