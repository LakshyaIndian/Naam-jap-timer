const themes=[
  {name:"Maroon",bg:"#3b0d0d",text:"#fff",card:"#1b1b22"},
  {name:"Lotus",bg:"#ffe4ec",text:"#000",card:"#ffffff"},
  {name:"Temple",bg:"#ffffff",text:"#000",card:"#f5f5f5"}
];

function applyTheme(t){
  document.documentElement.style.setProperty("--bg",t.bg);
  document.documentElement.style.setProperty("--text",t.text);
  document.documentElement.style.setProperty("--card",t.card);
  localStorage.setItem("theme",JSON.stringify(t));
}

function loadTheme(){
  try{
    const t=JSON.parse(localStorage.getItem("theme"));
    if(t) applyTheme(t);
  }catch{}
}

function renderThemes(){
  const el=document.getElementById("themesSection");
  el.innerHTML=themes.map((t,i)=>`<button onclick='applyTheme(themes[${i}])'>${t.name}</button>`).join("");
}
