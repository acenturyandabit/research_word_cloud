var express = require("express")
var stemmer = require('stemmer')
var bodyparser = require("body-parser");
var app = express();
app.use(express.static(__dirname + "/static"));
app.use(bodyparser.json());

if (typeof(String.prototype.trim) === "undefined") {
    String.prototype.trim = function() {
        return String(this).replace(/^\s+|\s+$/g, '');
    };
}

var fs = require("fs");
let articles = [];
//load old articles
let stopWords = {};
let originalStops = {}


function reloadStops() {
    originalStops = String(fs.readFileSync("stops")).split("\n").map(i => i.trim());
    stopWords = originalStops.map(i => stemmer(i)).reduce((p, i) => { p[i] = true; return p }, {});
    console.log(JSON.stringify(stopWords));
    //notStopWords = String(fs.readFileSync("notstops")).split("\n").map(i => stemmer(i).trim());
    //notStopWords = stopWords.reduce((p, i) => { p[i] = true; return p }, {});
}
reloadStops();
fs.readdir(__dirname + "/articleCache", (err, files) => {
    if (files) {
        for (f of files) {
            try {
                let text = fs.readFileSync("articleCache/" + f);
                articles.push(JSON.parse(text));
            } catch (e) {
                //continue
            }
        }
        console.log(`fetched ${articles.length} cached articles`);
        articles.sort((a, b) => a.publishDate - b.publishDate); // for optimised searching... later
        let badArticles = articles.filter(i => !i.publishDate);
        console.log(badArticles);
    }
})

app.get("/wordcloud", (req, res) => {
    if (isNaN(Number(req.query["fromTime"]))) {
        res.json({ error: "Invalid Start Time" }).end(400);
    } else if (isNaN(Number(req.query["toTime"]))) {
        res.json({ error: "Invalid End Time" }).end(400);
    } else {
        let validArticles = articles.filter(i => i.publishDate > req.query["fromTime"] && i.publishDate < req.query["toTime"]);
        let wordBins = {};
        validArticles.forEach(i => {
            i.abstract.split(/[\s,]+/g).forEach(w => {
                w = w.toLocaleLowerCase();
                let sw = stemmer(w);
                if (stopWords[sw]) return;
                if (w.length < 3) return;
                if (!isNaN(Number(w))) return;
                if (!wordBins[sw]) wordBins[sw] = { w: w, c: 1 };
                else wordBins[sw].c++;
            })
        });
        // kill stop words

        wordBins = Object.values(wordBins).map(i => ([i.w, i.c]));
        wordBins.sort((a, b) => b[1] - a[1]);
        res.json({ result: wordBins.slice(0, 100) }).status(200).end();
    }
})
app.get("/reloadStops", (req, res) => {
    reloadStops();
    res.send("Done").status(200).end();
})

app.post("/addStops", (req, res) => {
    if (fs.existsSync(".allowStopEdits")) {
        for (w of req.body) {
            originalStops.push(w);
        }
        fs.writeFileSync("stops", originalStops.join("\n"));
        reloadStops();
        res.send("Done").end(200);

    } else {
        res.status(401).send("401 UNAUTHORIZED").end();
    }
})
app.listen(8087);


var axios = require("axios");
var cheerio = require("cheerio");
(async() => {
    let curioStack = [];
    try {
        let curioText = fs.readFileSync("curioStack.json");
        curioStack = JSON.parse(curioText);
    } catch (e) {
        curioStack = [
            { type: "index", page: 1 }
        ]
    }
    let getStackTop = async() => {
        let top = curioStack.shift();
        console.log("top was " + JSON.stringify(top));
        if (top.type == "index") {
            let response = await axios.get(`https://www.nature.com/nature/articles?searchType=journalSearch&sort=PubDate&type=article&page=${top.page}`);
            let $ = cheerio.load(response.data);
            let titles = $("a[href*='/articles/']").map((i, e) => $(e).attr('href')).get();
            titles = titles.map(i => ({ href: i, type: "article" }));
            curioStack.push.apply(curioStack, titles);
            curioStack.push({ type: "index", page: top.page + 1 });
        } else if (top.type == "article") {
            let response = await axios.get(top.href);
            let $ = cheerio.load(response.data);
            let title = $("h1.c-article-title").text();
            let time = new Date($(".c-article-identifiers time").attr('datetime')).getTime();
            let abstract = $("#Abs1-section p").text();
            let newArticle = {
                publishDate: time,
                title: title,
                abstract: abstract,
                url: top.href,
                source: "www_nature_com"
            };
            console.log(newArticle);
            articles.push(newArticle);
            // save the article to a file
            fs.writeFileSync("articleCache/" + (title.replace(/\W/g, "_")) + "_" + time + ".json", JSON.stringify(newArticle));
        }
        fs.writeFileSync("curioStack.json", JSON.stringify(curioStack));
        setTimeout(getStackTop, 5000);
    };
    getStackTop();
})();