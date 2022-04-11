// ==UserScript==
// @name         Quoted
// @namespace    http://tampermonkey.net/
// @version      1.3.1
// @description  affiche qui vous cite dans le topic et vous permet d'accéder au message directement en cliquant sur le lien, même s'il est sur un page différente!
// @author       Dereliction
// @match        https://www.jeuxvideo.com/forums/*
// @icon         https://i.imgur.com/81NbMHq.png
// @license      Exclusive Copyright
// @resource     CSS https://pastebin.com/raw/fMWAQHTw
// @grant        GM_getResourceText
// @grant        GM_addStyle
// ==/UserScript==


(async function () {
    /*
    notes: ce script fonctionne mais a un défaut :
    - il se base sur la date des messages contenue (ou pas) dans les citations, si celle-ci est modifiée ça marche pas. Donc si votre message est cité mais que pour X raisons la citation n'a pas la date de votre message au bon format,
      alors le script ne le prendra pas en compte (problématique pour la compatibilité avec certains autres scripts)
      Possible fix en modifiant la regex de test dans la fonction getQuotedMsgDate

    Remarque : sont prises en compte les premières citations seulement, si le message est imbriqué dans des couches de citations, il ne sera pas retenu
    */

    'use strict';
    const currentPageMessages = getMessages();
    if (currentPageMessages.length <= 1 || window.location.pathname.includes('/message')) return;
    //le max de pages que le script peut aller chercher
    const maxPages = 100;
    //le nombre de pages que le script va charger par défaut. /!\ ne pas mettre un nombre trop important sinon ça va prendre énormément de temps à tout charger
    let nbPageATest = 10;
    if (localStorage.getItem('quoted-pages') != null && parseInt(localStorage.getItem('quoted-pages')) == localStorage.getItem('quoted-pages'))
        nbPageATest = Math.max(1, Math.min(Math.abs(localStorage.getItem('quoted-pages')), maxPages));

    let nbPageExploreesTotal = 0;

    //liste des messages de la page courante
    const messagesIndex = buildPageIndex();

    //les pemts qui ont eu lieu sur la page
    const pemts = initPEMT();



    //fonction qui lance le script
    (async function init() {
        const my_css = GM_getResourceText("CSS");
        GM_addStyle(my_css);
        createModal();
        createOptionButton();
        emphasizePost();
        displayLoading();

        //on récupère les relations dans la page courante et on initialise le tableau avec
        let pages = [{ page: 0, matches: processMessages(document) }];

        //pour chaque page on va récupérer son contenu puis faire les relations, et mettre le résultat dans le tableau
        for (let np of nextPages()) {
            await fetchPage(np.url).then((res) => { pages.push({ page: np.page, matches: processMessages(res) }) });
        };

        //on termine en affichant les liens dans la page courante
        createLinks(mergeAll(pages));
    })();


    //----------------------------------------------POUR L'AFFICHAGE DES OPTIONS--------------------------------------------------------

    //crée le bouton pour afficher le modal des options
    function createOptionButton() {
        const bloc = document.querySelector('#forum-main-col');
        let btnString = `<button class="btn quoted-btn">QUOTED</button>`
        let button = createElementFromString(btnString);
        button.addEventListener("click", (e) => {
            e.stopPropagation();
            const modal = document.querySelector('#quoted-options');
            toggleModal(modal);
        });
        bloc.insertBefore(button, bloc.querySelector('.bloc-pre-pagi-forum'));
    }

    //affiche le modal contenant la citation lorqu'on clique sur le bouton de prévisualiation
    function previsualize(msgOriginal, msgCitation) {
        if (msgOriginal.querySelector('.quoted-modal-citation') != null)
            msgOriginal.querySelector('.quoted-modal-citation').remove();
        let clone = msgCitation.cloneNode(true);
        if (clone.querySelector('.quoted-btn') != null)
            clone.querySelector('.quoted-btn').remove();
        let div = document.createElement('div');
        div.classList.add('quoted-modal-citation');
        const closeBtn = createElementFromString(`<div class="close"><button>X</button></div>`);
        div.addEventListener('click', () => {
            div.remove();
        });
        div.style.cursor = 'pointer';
        div.append(clone);
        let header = msgOriginal.querySelector('.bloc-header')
        header.append(div);
    }

    //modal des options
    function createModal() {
        const modalString = `<div id="quoted-options" class="quoted-modal-options">
        <h3> Options </h3>
        <div>
        <label for="quoted-page-input">Nombre de pages à sonder</label>
        <input type="number" id="quoted-page-input" value="${nbPageATest}" min="1" max="${maxPages}"></input>
        </div>
        <button id="quoted-confirm" class="btn quoted-btn">Valider</button>
        </div>
        `;
        const modal = createElementFromString(modalString);

        const bloc = document.querySelector('.bloc-pre-right');
        const mainCol = document.querySelector('#forum-main-col');
        mainCol.style.position = 'relative';

        mainCol.insertBefore(modal, document.querySelector('#forum-main-col>div:nth-last-child(1)'));
        let input = document.querySelector('#quoted-page-input');
        input.addEventListener('change', () => {
            changeNbPagesATest();
        });
        let confirmBtn = document.querySelector('#quoted-confirm');

        document.addEventListener('click', (e) => {
            let pos = modal.getBoundingClientRect()
            if (modal.style.display == "flex" && !((e.clientX >= pos.x && e.clientX <= (pos.x + pos.width)) && (e.clientY >= pos.y && e.clientY <= (pos.y + pos.height))))
                toggleModal(modal);
        });

        confirmBtn.addEventListener('click', () => {
            changeNbPagesATest();
            toggleModal(modal);
        });
    }

    function changeNbPagesATest() {
        let numberToStore = document.querySelector('#quoted-page-input').value;
        if ((numberToStore == null || numberToStore == '') || (parseInt(numberToStore) != numberToStore) || parseInt(numberToStore) > maxPages)
            localStorage.setItem('quoted-pages', 10);
        else
            localStorage.setItem('quoted-pages', numberToStore);
    }

    function toggleModal(modal) {
        if (modal.style.display != 'flex') {
            modal.style.display = 'flex';
            modal.classList.remove('quoted-invisible');
            modal.classList.add('quoted-visible');
        }
        else {
            modal.classList.remove('quoted-visible');
            modal.classList.add('quoted-invisible');
            setTimeout(() => { modal.style.display = 'none'; }, 500);
        }
    }

    //------------------------------------------------LOGIQUE DU SCRIPT-----------------------------------------------------------------


    //rend le post sur lequel on est redirigé plus visible
    function emphasizePost(url = window.location.hash){
        const prev = document.querySelector('.quoted-highlighted');
        if (prev)
            prev.classList.remove('quoted-highlighted');

        let id = (url.match(/post_(\d+)$/))? url.match(/post_(\d+)$/)[1] : false;
        if(!id) return;

        let message = [...messagesIndex.keys()].filter(msg => extractId(msg)==id)[0] ?? null;
        message.classList.add('quoted-highlighted');
    }



    //récupère les dates de tous les posts qui ont fait un pemt et les renvoie dans un tableau en supprimant les doublons @return array
    function initPEMT() {
        let sorted = [...messagesIndex.entries()].sort();
        let entries = [];
        for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i][1] === sorted[i + 1][1]) {
                entries.push(sorted[i][1]);
            }
        }
        return [...new Set(entries)];
    }


    //affiche un message de chargement sur les messages qui sera retiré quand tout aura été chargé
    function displayLoading() {
        currentPageMessages.forEach(msg => {
            msg.querySelector('.bloc-header').style.height = '5rem'
            let loading = document.createElement('div');
            loading.classList.add('loading-citations', 'quoted-color');
            loading.innerHTML = 'Chargement des citations...';

            let header = msg.querySelector('.bloc-header .bloc-date-msg');
            header.insertBefore(loading, header.firstChild);
        });
    }

    //parcourt la map passée en paramètre et pour chaque clé (message de la page courante), appelle la méthode pour ajouter la ou les citation(s) en valeur. Supprime également les messages de chargement
    function createLinks(correspondances) {
        correspondances.forEach((v, k) => {
            appendCitation(k, v);
        });
        let loadings = document.querySelectorAll('.loading-citations');
        for (let ele of loadings) { ele.remove() }
        console.log('Messages chargés (' + nbPageExploreesTotal + ' page(s) explorée(s))');
    }

    //pour le message passé en paramètre, append un lien vers le(s) message(s) du tableau en paramètre @param msgsC : tableau d'objets de la forme {page:x, msg:x}
    function appendCitation(original, msgsC) {
        original.querySelector('.bloc-header').style.height = '5.75rem';
        let header = original.querySelector('.bloc-header');

        const blocC = document.createElement('div');
        blocC.classList.add('quoted-msg-citations', 'quoted-color');
        blocC.innerHTML = '<span>Cité ' + msgsC.length + ' fois : </span>';
        header.insertBefore(blocC, header.querySelector('.bloc-date-msg'));
        let count = 1;
        let links = msgsC.map(obj => { return { link: generateLink(extractId(obj.msg), obj.page), author: extractAuthor(obj.msg), page: ((obj.page != 0) ? ' (page ' + obj.page + ')' : '') } });
        createSelect(links).forEach(ele => {
            blocC.append(ele);
        });
        const previewBtn = createElementFromString(`<button class="quoted-btn quoted-preview-btn">Prévisualiser</button>`);
        previewBtn.addEventListener('click', () => {
            let linkS = original.querySelector('.quoted-goto').getAttribute('href').split('_');
            let id = linkS[linkS.length - 1];
            previsualize(original, msgsC.filter(obj => extractId(obj.msg) === id)[0].msg);
        });
        if (window.screen.width < 500) {
            blocC.append(document.createElement('br'), previewBtn);
            original.querySelector('.bloc-header').style.height = '7rem';
            previewBtn.style.marginLeft = '0';
        }
        else
            blocC.append(previewBtn);
    }

    //crée le select ou le lien pour choisir quelle citation charger
    function createSelect(links) {
        if (links.length == 1) {
            let link = links[0];
            let aref = createElementFromString(`<a class="quoted-goto" href="${link.link}">${link.author}${link.page}</a>`);
            aref.addEventListener('click', () => {
                emphasizePost(aref.getAttribute('href'));
            });
            return [aref];
        }
        let select = document.createElement('select');
        select.classList.add('quoted-select');
        let redir = document.createElement('a');
        redir.classList.add('quoted-goto');
        redir.innerText = 'Aller';
        redir.setAttribute('href', links[0].link);
        redir.addEventListener('click', ()=>{
            emphasizePost(redir.getAttribute('href'));
        });
        select.addEventListener('change', () => {
            redir.setAttribute('href', select.options[select.selectedIndex].value);
        });
        links.forEach(link => {
            let option = createElementFromString(`<option value="${link.link}">${link.author}${link.page}</option>`);
            select.append(option);
        });
        return [select, redir];
    }

    //génère le lien pour le post sur la page en fonction du numéro de la page donnée et de l'id du post @Return string
    function generateLink(id, page) {
        let reg = /(.*forums\/\d*-\d*-\d*-)(\d*)(.*)/gm;
        let url = "https://www.jeuxvideo.com" + window.location.pathname;
        if (page == 0)
            return url + "#post_" + id;
        return url.replace(reg, "$1" + page + "$3") + "#post_" + id;
    }

    //fonction qui prend un tableau de maps en argument et les merge toutes ensemble @Return Map
    function mergeAll(maps) {
        maps.forEach(obj => {
            obj.matches.forEach((arrayV, k) => {
                obj.matches.set(k, arrayV.map((msg) => { return { page: obj.page, msg: msg } }));
            });
        });
        let allMapsMerged = maps[0].matches;
        for (let i = 1; i < maps.length; i++) {
            allMapsMerged = mergeMaps(allMapsMerged, maps[i].matches);
        }
        return allMapsMerged;
    }

    //fonction qui fusionne deux map en une seule, en concaténant les tableaux quand les maps ont la même clé @Return Map
    function mergeMaps(mapA, mapB) {
        let myMap = new Map([...mapA]);
        mapB.forEach((v, k) => {
            if (myMap.has(k)) {
                let arr = [...myMap.get(k)];
                arr.push(...v);
                myMap.set(k, arr);
            }
            else {
                myMap.set(k, [...v]);
            }
        });
        return myMap;
    }

    //parcourt les messages de la page donnée, s'ils contiennent une citation alors on récupère sa date puis on vérifie dans le Map si elle correspond à un message. Si c'est le cas, on ajoute le message
    function processMessages(page = document) {
        let messages = getMessages(page);
        let matches = new Map();
        messages.forEach(msg => {
            if (msg.querySelector('blockquote') != null) {
                let dates = getQuotedMsgDate(msg);
                messagesIndex.forEach((msgIValue, msgIKey) => {
                    if (dates.includes(msgIValue)) {
                        const quoteFromPEMT = (dates.filter(value => pemts.includes(value)).length > 0);//on teste si les dates du message viennent de pemt, si c'est le cas on applique l'algo de filtrage
                        if (!quoteFromPEMT || (quoteFromPEMT && antiPEMT(msgIKey, msg))) {
                            if (!matches.has(msgIKey)) matches.set(msgIKey, [msg]);
                            else {
                                let arr = matches.get(msgIKey);
                                arr.push(msg);
                                matches.set(msgIKey, arr);
                            }
                        }
                    }
                });
            }
        });
        return matches;
    }

    //pour debugger
    function debug(separator, ...values) {
        console.log('______________________________________START DEBUG : ' + separator + '_____________________________________________');
        values.forEach(v => {
            console.log(v);
        });
        console.log('**************************************END DEBUG : ' + separator + '**************************************');
    }

    //compare le contenu de la citation avec celui du message original. Si le texte de la citation est contenu dans le message original ou inversement, le test est validé, sinon non
    function antiPEMT(originalMsg, msg) {
        let msgTxt = Array.prototype.slice.call(msg.querySelectorAll('.txt-msg>blockquote>p')).map((ele) => ele.textContent).reduce((next, current) => current + " " + next, '');
        let originalTxt = extractDate(originalMsg) + ' :' + Array.prototype.slice.call(originalMsg.querySelectorAll('.txt-msg>p')).map((ele) => ele.textContent).reduce((next, current) => current + " " + next, '');
        msgTxt = msgTxt.replace(/\s/gm, "").replace(/(Le)?\d{2}\w+\d{4}à\d{2}:\d{2}:\d{2}:?(.*aécrit:)?/gm, "").replace(/⭐/gm, '').replace(/ouvrir/gm, '');
        originalTxt = originalTxt.replace(/\s/gm, "").replace(/(Le)?\d{2}\w+\d{4}à\d{2}:\d{2}:\d{2}:?(.*aécrit:)?/gm, "").replace(/⭐/gm, '').replace(/ouvrir/gm, '');

        /*
        console.log('____________________________________________________________________________________________');
        console.log('CONTENU DE LA CITATION : ' + msgTxt);
        console.log('CONTENU DU MESSAGE ORIGINAL : ' + originalTxt);
        console.log('LES MESSAGES CORRESPONDENT : ' + (originalTxt.includes(msgTxt)||msgTxt.includes(originalTxt)));
        */
        if (msgTxt === '') return originalTxt === '';
        if (originalTxt === '') return msgTxt === '';
        return (originalTxt.includes(msgTxt) || msgTxt.includes(originalTxt));
    }

    //recupère les dates des messages cités dans le message @Return array
    function getQuotedMsgDate(message) {
        let firstQuotes = Array.prototype.slice.call(message.querySelectorAll('.txt-msg > .blockquote-jv'));
        let reg = /\d{2}\s.+\s\d{4}\sà\s\d{2}:\d{2}:\d{2}/gm;
        let dates = firstQuotes.map((quote) => {
            if (quote.querySelector('p') == null) return '';
            let test = quote.querySelector('p').textContent.match(reg);
            if (test != null) return test[0];
        });

        return dates;
    }

    //renvoie les messages contenus par l'élément passé en paramètre @Return array
    function getMessages(element = document) {
        return Array.prototype.slice.call(element.querySelectorAll('.conteneur-messages-pagi .bloc-message-forum:not(.msg-supprime)'));
    }

    //crée un dictionnaire contenant en index les messages de la page courante et en valeur leurs dates @Return Map
    function buildPageIndex() {
        let messages = document.querySelectorAll('.bloc-message-forum:not(.msg-supprime)'); //on ignore les messages de jvarchive pour le moment
        let res = new Map();
        messages.forEach(msg => {
            res.set(msg, extractDate(msg));
        });
        return res;
    }

    //récupère la date du message @Return string
    function extractDate(message) {
        let dateLink = message.querySelector('.bloc-header .bloc-date-msg a');
        let date = message.querySelector('.bloc-date-msg').textContent.trim();
        return date;
    }

    //récupère l'id du message @Return string
    function extractId(message) {
        return message.getAttribute('data-id');
    }

    //récupère le pseudo de l'auteur du message @Return string
    function extractAuthor(message) {
        return message.querySelector('.bloc-pseudo-msg').textContent.trim();
    }

    //crée un élément en fonction de la chaîne donnée @Return HTMLElement
    function createElementFromString(htmlString) {
        var div = document.createElement('div');
        div.innerHTML = htmlString.trim();
        return div.firstChild;
    }

    //va chercher la page donnée en paramètre et transforme la réponse en élément html @Return HTMLElement
    async function fetchPage(url) {
        let response = await fetch(url);
        let texte = await response.text();
        let parser = new DOMParser();
        return parser.parseFromString(texte, 'text/html');
    }

    //retourne un tableau contenant les url de toutes les pages suivantes du topic @Return array
    function nextPages(max = nbPageATest) {
        let avantDernierSpan = document.querySelector('.bloc-liste-num-page span:nth-last-child(2)');
        let maxPages = parseInt(document.querySelector('.bloc-liste-num-page span:last-child').textContent);
        if (isNaN(maxPages)) {
            maxPages = parseInt(avantDernierSpan.textContent);
        }
        let currentPage = window.location.pathname;
        let pagesIndexed = [];
        let splited = currentPage.split('-');
        let currentId = parseInt(splited[3]);
        let nbPagesAParcourir = Math.min(maxPages, currentId + max);
        for (let i = currentId; i < nbPagesAParcourir; i++) {
            splited[3] = ++currentId;
            pagesIndexed.push({ page: currentId, url: splited.join('-') });
        }
        nbPageExploreesTotal = pagesIndexed.length + 1;
        return pagesIndexed;
    }

})();