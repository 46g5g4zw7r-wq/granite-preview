// Скрипт для page.addInitScript: поддельный сервер вместо Supabase (тесты работают без сети).
// opts.as = "admin" — сразу вошёл администратор (для тестов отдельных экранов).
var fs = require("fs"), path = require("path");
module.exports = function (opts) {
  opts = opts || {};
  var src = fs.readFileSync(path.join(__dirname, "fake-backend.js"), "utf8");
  var seed = "";
  if (opts.as === "admin") {
    seed = "(function(){var raw=Storage.prototype.getItem,set=Storage.prototype.setItem;" +
      "if(!raw.call(localStorage,'__fakeDB')){set.call(localStorage,'__fakeDB',JSON.stringify({users:{'andrey_sazonov@icloud.com':{id:'u-admin',email:'andrey_sazonov@icloud.com',pw:'adminpass1'}}," +
      "profiles:{'u-admin':{id:'u-admin',email:'andrey_sazonov@icloud.com',name:'',position:'',shift:'',section:'admin',must_change:false}},items:{},logs:[],kv:{},seq:0,photos:{},calls:[]}));" +
      "set.call(localStorage,'__fakeUser',JSON.stringify({id:'u-admin',email:'andrey_sazonov@icloud.com'}));}" +
      "if(!sessionStorage.getItem('granite.session'))sessionStorage.setItem('granite.session',JSON.stringify({section:'admin',admin:true,email:'andrey_sazonov@icloud.com',name:''}));})();";
  }
  // Настоящий supabase.js не нужен: cloud.js берёт window.SLAB_BACKEND
  return src + "\n" + seed;
};
