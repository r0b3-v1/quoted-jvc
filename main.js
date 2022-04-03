// ==UserScript==
// @name         Quoted
// @namespace    http://tampermonkey.net/
// @version      0.5.1
// @description  affiche qui vous cite dans le topic et vous permet d'accéder au message directement en cliquant sur le lien, même s'il est sur un page différente!
// @author       Dereliction
// @match        https://www.jeuxvideo.com/forums/*
// @icon         https://i.imgur.com/81NbMHq.png
// @license      MIT
// @resource     CSS https://pastebin.com/raw/fMWAQHTw
// @grant        GM_getResourceText
// @grant        GM_addStyle
// ==/UserScript==
(async function () {
    /*
    notes: ce script fonctionne mais a quelques défauts :
    - parfois lent à charger
    - il se base sur la date des messages contenue (ou pas) dans les citations, si celle-ci est modifiée ça marche pas.
    - en cas de PEMT, il risque de faire de la merde
    - si votre message est cité mais que pour X raisons la citation n'a pas la date de votre message au bon format, alors le script ne le prendra pas en compte (problématique pour la compatibilité avec certains autres scripts)
    - probablement des bugs pas encore explorés
    - si le message est cité trop de fois alors ça risque de déborder, pas encore fait l'adaptation de la taille du header en fonction du nombre de citations

    Remarque : sont prises en compte les premières citations seulement, si le message est imbriqué dans des couches de citations, il ne sera pas retenu
    */

    'use strict';

    if (getMessages().length == 0 || window.location.pathname.includes('/message')) return;
    //le max de pages que le script peut aller chercher
    const maxPages = 20;
    //le nombre de pages que le script va charger pour voir si les messages de la page courante sont cités. /!\ ne pas mettre un nombre trop important sinon ça va prendre énormément de temps à tout charger
    let nbPageATest = 10;
    if (localStorage.getItem('quoted-pages') != null && parseInt(localStorage.getItem('quoted-pages')) == localStorage.getItem('quoted-pages'))
        nbPageATest = Math.max(1, Math.min(Math.abs(localStorage.getItem('quoted-pages')), maxPages));

    let nbPageExploreesTotal = 0;

    //liste des messages de la page courante
    const messagesIndex = buildMessages();

    //fonction qui lance le script
    (async function init() {
        const my_css = GM_getResourceText("CSS");
        GM_addStyle(my_css);

        displayLoading();

        //on récupère les relations dans la page courante et on initialise le tableau avec
        let pages = [{ page: 0, matches: processMessages(document) }];

        //pour chaque page on va récupérer son contenu puis faire les relations également, et mettre le résultat dans le tableau
        for (let np of nextPages()) {
            await fetchPage(np.url).then((res) => { pages.push({ page: np.page, matches: processMessages(res) }) });
        };

        //on termine en affichant les liens dans la page courante
        createLinks(mergeAll(pages));
    })();


    //----------------------------------------------POUR L'AFFICHAGE DES OPTIONS--------------------------------------------------------

    modal(toggleModal);
    optionButton(toggleModal);
    function optionButton(toggleFunction) {
        const bloc = document.querySelector('.bloc-pre-right');
        let btnString = `<button class="btn quoted-btn">Quoted Options</button>`
        let button = createElementFromString(btnString).firstChild;
        button.addEventListener("click", () => {
            const modal = document.querySelector('#quoted-options');
            toggleFunction(modal);

        });
        bloc.insertBefore(button, bloc.firstChild);
    }

    function modal(toggleFunction) {
        const modalString = `<div id="quoted-options" class="quoted-modal-options">
        <h3> Options </h3>
        <div>
        <label for="quoted-page-input">Nombre de pages à sonder</label>
        <input type="number" id="quoted-page-input" value="${nbPageATest}" min="1" max="20"></input>
        </div>
        <button id="quoted-confirm" class="btn quoted-btn">Valider</button>
        </div>
        `;
        const modal = createElementFromString(modalString).firstChild;

        const bloc = document.querySelector('.bloc-pre-right');
        const mainCol = document.querySelector('#forum-main-col');
        mainCol.style.position = 'relative';

        mainCol.insertBefore(modal, document.querySelector('#forum-main-col>div:nth-last-child(1)'));
        let confirmBtn = document.querySelector('#quoted-confirm');
        confirmBtn.addEventListener('click', () => {
            let numberToStore = document.querySelector('#quoted-page-input').value;
            if ((numberToStore == null) || (parseInt(numberToStore) != numberToStore) || parseInt(numberToStore) > maxPages)
                localStorage.setItem('quoted-pages', 10);
            else
                localStorage.setItem('quoted-pages', numberToStore);
            toggleFunction(modal);
        });

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

    //affiche un message de chargement sur les messages qui sera retiré quand tout aura été chargé
    function displayLoading() {
        let messages = getMessages();

        messages.forEach(msg => {
            msg.querySelector('.bloc-header').style.height = '5rem'
            let loading = document.createElement('div');
            loading.classList.add('loading-citations');
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

    //pour le message passé en paramètre, append un lien vers le(s) message(s) du tableau en paramètre
    function appendCitation(original, msgsC) {
        original.querySelector('.bloc-header').style.height = '5rem';
        let header = original.querySelector('.bloc-header .bloc-date-msg');
        const blocC = document.createElement('div');
        blocC.classList.add('msg-citations');
        blocC.innerHTML = 'Message cité ' + msgsC.length + ' fois : ';
        header.insertBefore(blocC, header.firstChild);
        let count = 1;
        msgsC.forEach(msg => {
            blocC.innerHTML += `<a href="${generateLink(extractId(msg.msg), msg.page)}">${extractAuthor(msg.msg)}${(msg.page != 0) ? '(p' + msg.page + ')' : ''}</a>` + ((count++ != msgsC.length) ? ', ' : '');
        });
    }

    //génère le lien pour le post sur la page en fonction du numéro de la page donnée et de l'id du post
    function generateLink(id, page) {
        let reg = /(.*forums\/\d*-\d*-\d*-)(\d*)(.*)/gm;
        let url = "https://www.jeuxvideo.com" + window.location.pathname;
        if (page == 0)
            return url + "#post_" + id;
        return url.replace(reg, "$1" + page + "$3") + "#post_" + id;
    }

    //fonction qui prend un tableau de maps en argument et les merge toutes ensemble : Map
    function mergeAll(maps) {
        maps.forEach(obj => {
            obj.matches.forEach((arrayV, k) => {
                obj.matches.set(k, arrayV.map((msg) => { return { page: obj.page, msg: msg } }));
            });
        });
        let init = maps[0].matches;
        for (let i = 1; i < maps.length; i++) {
            init = mergeMaps(init, maps[i].matches, maps[i].page);
        }

        return init;
    }

    //fonction qui fusionne deux map en une seule, en concaténant les tableaux quand les maps ont la même clé : Map
    function mergeMaps(mapA, mapB, page = 0) {

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
                        //antiPEMT(msgIKey,msg); //ici faire la condition avec antiPEMT pour savoir si le message cité est le bon
                        if (!matches.has(msgIKey)) matches.set(msgIKey, [msg]);
                        else {
                            let arr = matches.get(msgIKey);
                            arr.push(msg);
                            matches.set(msgIKey, arr);
                        }
                    }
                });
            }
        });
        return matches;
    }

    //PAS ENCORE FONCTIONNEL Dans l'idée : compare le contenu de la citation avec celui du message original. Si le texte de la citation est contenu au moins en partie dans le message original, le test est validé, sinon non
    function antiPEMT(originalMsg, msg) {
        let msgTxt = Array.prototype.slice.call(msg.querySelectorAll('blockquote>p')).map((ele) => ele.textContent).reduce((next, current) => current + " " + next, '');
        let originalTxt = extractDate(originalMsg) + ' :' + Array.prototype.slice.call(originalMsg.querySelectorAll('.txt-msg>p')).map((ele) => ele.textContent).reduce((next, current) => current + " " + next, '');
        console.log('CONTENU DE LA CITATION : ' + msgTxt);
        console.log('CONTENU DU MESSAGE ORIGINAL : ' + originalTxt);
    }

    //recupère les dates des messages cités dans le message : array
    function getQuotedMsgDate(message) {
        let firstQuotes = Array.prototype.slice.call(message.querySelectorAll('.txt-msg > .blockquote-jv'));
        let reg = /\d{2}\s\w+\s\d{4}\sà\s\d{2}:\d{2}:\d{2}/gm;
        let dates = firstQuotes.map((quote) => {
            if (quote.querySelector('p') == null) return '';
            let test = quote.querySelector('p').textContent.match(reg);
            if (test != null) return test[0];
        });

        return dates;
    }

    //renvoie les messages contenus par l'élément passé en paramètre : array
    function getMessages(element = document) {
        return Array.prototype.slice.call(element.querySelectorAll('.conteneur-messages-pagi .bloc-message-forum:not(.msg-supprime)'));
    }

    //crée un dictionnaire contenant en index les messages de la page courante et en valeur leurs dates : Map
    function buildMessages() {
        let messages = document.querySelectorAll('.bloc-message-forum:not(.msg-supprime)'); //on ignore les messages de jvarchive pour le moment
        let res = new Map();
        messages.forEach(msg => {
            res.set(msg, extractDate(msg));
        });
        return res;
    }

    //récupère la date du message : string
    function extractDate(message) {
        let dateLink = message.querySelector('.bloc-header .bloc-date-msg a');
        if (dateLink != null)
            return dateLink.textContent;
        else
            return '';
    }

    //récupère l'id du message passé en paramètre : string
    function extractId(message) {
        return message.getAttribute('data-id');
    }

    //récupère le pseudo de l'auteur du message : string
    function extractAuthor(message) {
        return message.querySelector('.bloc-pseudo-msg').textContent;
    }

    //crée un élément en fonction de la chaîne donnée : HTMLElement
    function createElementFromString(htmlString) {
        var div = document.createElement('div');
        div.innerHTML = htmlString.trim();

        return div;
    }

    //va chercher la page donnée en paramètre : string
    async function fetchPage(url) {
        let response = await fetch(url);
        let texte = await response.text();
        return createElementFromString(texte);
    }

    //retourne un tableau contenant les url de toutes les pages suivantes du topic : array
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