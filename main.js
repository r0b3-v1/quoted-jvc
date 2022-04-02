// ==UserScript==
// @name         Quoted
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       Dereliction
// @match        https://www.jeuxvideo.com/forums/*
// @icon         https://i.imgur.com/voSoOfb.png
// @grant        none
// ==/UserScript==
(async function() {
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
        if (getMessages().length ==0 || window.location.pathname.includes('/message')) return;
    
        displayLoading();
        //le nombre de pages que le script va charger pour voir si les messages de la page courante sont cités. /!\ ne pas mettre un nombre trop important sinon ça va prendre énormément de temps à tout charger
        const nbPageATest = 20;
    
        //liste des messages de la page courante
        const messagesIndex = buildMessages();
    
        //on récupère les relations dans la page courante et on initialise le tableau avec
        let pages = [processMessages(document)];
    
        //pour chaque page on va récupérer son contenu puis faire les relations également, et mettre le résultat dans le tableau
        for(let np of nextPages()){
            await fetchPage(np).then((res)=>{ pages.push(processMessages(res))});
        };
    
        //on termine en affichant les liens dans la page courante
        createLinks(mergeAll(pages));
    
        //affiche un message de chargement sur les messages qui sera retiré quand tout aura été chargé
        function displayLoading(){
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
        function createLinks(correspondances){
    
            correspondances.forEach((v,k) =>{
                appendCitation(k,v);
            });
            let loadings = document.querySelectorAll('.loading-citations');
            for (let ele of loadings) {ele.remove()}
            console.log('Messages chargés');
        }
    
        //pour le message passé en paramètre, append un lien vers le(s) message(s) du tableau en paramètre
        function appendCitation(original, msgsC){
             original.querySelector('.bloc-header').style.height = '5rem';
            let header = original.querySelector('.bloc-header .bloc-date-msg');
            const blocC = document.createElement('div');
            blocC.classList.add('msg-citations');
            blocC.innerHTML = 'Message cité ' + msgsC.length + ' fois : ';
            header.insertBefore(blocC, header.firstChild);
            let count = 1;
            msgsC.forEach(msg => {
                blocC.innerHTML += `<a target="_blank" href="https://www.jeuxvideo.com/forums/message/${extractId(msg)}">${extractAuthor(msg)}</a>` + ((count++ != msgsC.length)? ', ' : '');
    
            });
        }
    
        //fonction qui prend un tableau de maps en argument et les merge toutes ensemble : Map
        function mergeAll(maps){
            let init = maps[0];
            for(let i = 1; i<maps.length; i++){
                init = mergeMaps(init, maps[i]);
            }
            return init;
        }
    
        //fonction qui fusionne deux map en une seule, en concaténant les tableaux quand les maps ont la même clé : Map
        function mergeMaps(mapA, mapB){
            let myMap = new Map([...mapA]);
            mapB.forEach((v,k)=>{
                if(myMap.has(k)){
                    let arr = [...myMap.get(k)];
                    arr.push(...v);
                    myMap.set(k,arr);
                }
                else{
                    myMap.set(k,[...v]);
                }
            });
            return myMap;
        }
    
        //parcourt les messages de la page donnée, s'ils contiennent une citation alors on récupère sa date puis on vérifie dans le Map si elle correspond à un message. Si c'est le cas, on ajoute le message
        function processMessages(page=document){
            let messages = getMessages(page);
            let matches = new Map();
            messages.forEach(msg => {
                if(msg.querySelector('blockquote')!=null){
                    let dates = getQuotedMsgDate(msg);
                    messagesIndex.forEach((msgIValue, msgIKey) => {
                        if(dates.includes(msgIValue)){
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
    
        //recupère les dates des messages cités dans le message : array
        function getQuotedMsgDate(message){
            let firstQuotes = Array.prototype.slice.call(message.querySelectorAll('.txt-msg > .blockquote-jv'));
            let reg = /\d{2}\s\w+\s\d{4}\sà\s\d{2}:\d{2}:\d{2}/gm;
            let dates = firstQuotes.map((quote)=>{
                if (quote.querySelector('p') == null) return '';
                let test = quote.querySelector('p').textContent.match(reg);
                if (test != null) return test[0];
            });
    
            return dates;
        }
    
        //renvoie les messages contenus par l'élément passé en paramètre : array
        function getMessages(element=document){
            return Array.prototype.slice.call(element.querySelectorAll('.bloc-message-forum:not(.msg-supprime)'));
        }
    
        //crée un dictionnaire contenant en index les messages de la page courante et en valeur leurs dates : Map
        function buildMessages(){
            let messages = document.querySelectorAll('.bloc-message-forum:not(.msg-supprime)'); //on ignore les messages de jvarchive pour le moment
            let res = new Map();
            messages.forEach(msg => {
                res.set(msg, extractDate(msg));
            });
            return res;
        }
    
        //récupère la date du message : string
        function extractDate(message){
            let dateLink = message.querySelector('.bloc-header .bloc-date-msg a');
            if (dateLink != null)
                return dateLink.textContent;
            else
                return '';
        }
    
        //récupère l'id du message passé en paramètre : string
        function extractId(message){
            return message.getAttribute('data-id');
        }
    
        //récupère le pseudo de l'auteur du message : string
        function extractAuthor(message){
            return message.querySelector('.bloc-pseudo-msg').textContent;
        }
    
        //crée un élément en fonction de la chaîne donnée : HTMLElement
        function createElementFromString(htmlString){
          var div = document.createElement('div');
            div.innerHTML = htmlString.trim();
    
            return div;
        }
    
        //va chercher la page donnée en paramètre : string
        async function fetchPage(url){
            let response = await fetch(url);
            let texte = await response.text();
            return createElementFromString(texte);
        }
    
        //retourne un tableau contenant les url de toutes les pages suivantes du topic : array
        function nextPages(max=nbPageATest){
            let avantDernierSpan = document.querySelector('.bloc-liste-num-page span:nth-last-child(2)');
            let maxPages = parseInt(document.querySelector('.bloc-liste-num-page span:last-child').textContent);
            if (isNaN(maxPages)){
                maxPages = parseInt(avantDernierSpan.textContent);
            }
            let currentPage = window.location.pathname;
            let pagesUrls = [];
            let splited = currentPage.split('-');
            let currentId = parseInt(splited[3]);
            let nbPagesAParcourir = Math.min(maxPages, currentId + max);
            for(let i=currentId; i<nbPagesAParcourir;i++){
                splited[3] = ++currentId;
                pagesUrls.push(splited.join('-'));
            }
            return pagesUrls;
        }
    
    })();