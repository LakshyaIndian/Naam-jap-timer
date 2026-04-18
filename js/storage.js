const STORAGE_KEY = "mala_data_v1";
function safeRead(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||{}}catch{return {}}}
function safeWrite(data){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data))}catch{}}
function getTodayKey(){return new Date().toISOString().split("T")[0]}
function getData(){return safeRead()}
function saveData(data){safeWrite(data)}