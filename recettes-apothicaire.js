/* Recettes de l'alchimiste apothicaire, par rang (n : nom, r : rang 0 à 4, h : durée en heures, v : valeur, i : ingrédients [catégorie, précision, propriétés],
   o : outils, s : caractéristique du test, dd : DD de base, p : propriétés, f : interdit / réglementé, sp : spécialisation).
   L'onglet Récolte propose celles dont le rang ne dépasse pas celui du personnage ; les recettes interdites ou réglementées restent cachées. */
window.APO = [
{
"n": "Antitoxine",
"r": 0,
"h": 40,
"v": "50 po",
"i": [
[
"Toxine",
"",
"toxique"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Int",
"dd": 5,
"p": "fluide",
"f": "",
"sp": ""
},
{
"n": "Chandelle",
"r": 0,
"h": 1,
"v": "1 pc",
"i": [
[
"Peau",
"",
""
],
[
"Ficelle",
"",
""
]
],
"o": "matériel d'alchimiste, une source de chaleur",
"s": "Dex",
"dd": 5,
"p": "aucune",
"f": "",
"sp": ""
},
{
"n": "Cire à cacheter",
"r": 0,
"h": 1,
"v": "5 pa",
"i": [
[
"Colle",
"",
"fluide"
],
[
"Huile",
"",
"inflammable, fluide"
]
],
"o": "matériel d'alchimiste, une source de chaleur",
"s": "Int",
"dd": 5,
"p": "aucune",
"f": "",
"sp": ""
},
{
"n": "Colle",
"r": 0,
"h": 1,
"v": "1 pa",
"i": [
[
"Peau",
"",
""
],
[
"Eau",
"",
"fluide"
]
],
"o": "matériel d'alchimiste, une source de chaleur",
"s": "Int",
"dd": 5,
"p": "fluide",
"f": "",
"sp": ""
},
{
"n": "Craie",
"r": 0,
"h": 1,
"v": "1 pc",
"i": [
[
"Roche",
"",
"calcaire blanc"
]
],
"o": "matériel d'alchimiste",
"s": "Sag",
"dd": 5,
"p": "aucune",
"f": "",
"sp": ""
},
{
"n": "Encre",
"r": 0,
"h": 8,
"v": "10 po",
"i": [
[
"Eau",
"",
"fluide"
],
[
"Pigment",
"",
"tachant"
]
],
"o": "matériel d'alchimiste",
"s": "Int",
"dd": 5,
"p": "fluide, tachant",
"f": "",
"sp": ""
},
{
"n": "Huile",
"r": 0,
"h": 8,
"v": "1 pa",
"i": [
[
"Peau",
"",
""
]
],
"o": "matériel d'alchimiste, une source de chaleur",
"s": "Int",
"dd": 5,
"p": "inflammable, fluide",
"f": "",
"sp": ""
},
{
"n": "Peinture",
"r": 0,
"h": 4,
"v": "5 po",
"i": [
[
"Pigment",
"",
"tachant"
],
[
"Eau",
"",
"fluide"
]
],
"o": "matériel d'alchimiste, matériel de peintre",
"s": "Int",
"dd": 5,
"p": "fluide, tachant",
"f": "",
"sp": ""
},
{
"n": "Savon",
"r": 0,
"h": 1,
"v": "2 pc",
"i": [
[
"Parfum",
"",
"fluide"
],
[
"Huile",
"",
"inflammable, fluide"
]
],
"o": "matériel d'alchimiste, une source de chaleur",
"s": "Sag",
"dd": 5,
"p": "aucune",
"f": "",
"sp": ""
},
{
"n": "Décoction de guérison",
"r": 1,
"h": 4,
"v": "20 po",
"i": [
[
"Eau",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 10,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Essence d'euphraise",
"r": 1,
"h": 6,
"v": "20 po",
"i": [
[
"Eau",
"",
"fluide"
],
[
"Médicinal",
"Euphraise",
"unique"
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 10,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Infusion sainte",
"r": 1,
"h": 30,
"v": "90 po",
"i": [
[
"Eau",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 10,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Potion de purification",
"r": 1,
"h": 34,
"v": "100 po",
"i": [
[
"Eau",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 10,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Potion de guérison",
"r": 1,
"h": 8,
"v": "50 po",
"i": [
[
"Décoction de guérison",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 10,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Tonique auditif",
"r": 1,
"h": 6,
"v": "20 po",
"i": [
[
"Eau",
"",
"fluide"
],
[
"Médicinal",
"bouchon de cire",
"unique"
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 10,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Baume de régénération",
"r": 2,
"h": 18,
"v": "175 po",
"i": [
[
"Huile",
"",
"inflammable, fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 15,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Baume réparateur",
"r": 2,
"h": 18,
"v": "175 po",
"i": [
[
"Huile",
"",
"inflammable, fluide"
],
[
"Médicinal",
"Aloès",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 15,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Potion de peau d'écorce",
"r": 2,
"h": 18,
"v": "175 po",
"i": [
[
"Baume d'altération",
"",
"fluide"
],
[
"Médicinal",
"Écorce",
"unique"
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 15,
"p": "fluide",
"f": "",
"sp": "Apothicaire, Abstracteur"
},
{
"n": "Potion de poison",
"r": 2,
"h": 18,
"v": "175 po",
"i": [
[
"Potion de guérison",
"",
"fluide"
],
[
"Toxines",
"",
"toxique"
]
],
"o": "kit d'empoisonneur",
"s": "Sag",
"dd": 15,
"p": "fluide",
"f": "interdit",
"sp": "Alkahest, Apothicaire"
},
{
"n": "Potion de résistance",
"r": 2,
"h": 18,
"v": "175 po",
"i": [
[
"Baume d'altération",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 15,
"p": "fluide",
"f": "",
"sp": "Apothicaire, Abstracteur"
},
{
"n": "Potion de respiration aquatique",
"r": 2,
"h": 18,
"v": "175 po",
"i": [
[
"Baume d'altération",
"",
"fluide"
],
[
"Essence élémentaire",
"Eau",
""
]
],
"o": "matériel d'alchimiste",
"s": "Sag",
"dd": 15,
"p": "fluide",
"f": "",
"sp": "Apothicaire, Abstracteur"
},
{
"n": "Potion de guérison majeure",
"r": 2,
"h": 20,
"v": "200 po",
"i": [
[
"Décoction de guérison",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 15,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Potion de santé",
"r": 2,
"h": 18,
"v": "175 po",
"i": [
[
"Décoction de guérison",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 15,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Baume de régénération majeur",
"r": 3,
"h": 250,
"v": "5 500 po",
"i": [
[
"Huile",
"",
"inflammable, fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Potion d'apaisement",
"r": 3,
"h": 250,
"v": "5 500 po",
"i": [
[
"Médicinal",
"",
""
],
[
"Stimulant",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "",
"sp": "Apothicaire, Abstracteur"
},
{
"n": "Potion d'héroïsme",
"r": 3,
"h": 250,
"v": "5 500 po",
"i": [
[
"Eau",
"",
"fluide"
],
[
"Os",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Potion de clairvoyance",
"r": 3,
"h": 250,
"v": "5 500 po",
"i": [
[
"Alcool",
"",
"inflammable, fluide"
],
[
"Psychotrope",
"",
"psychédélique"
]
],
"o": "matériel d'alchimiste",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "",
"sp": "Apothicaire, Abstracteur"
},
{
"n": "Potion de lecture des pensées",
"r": 3,
"h": 250,
"v": "5 500 po",
"i": [
[
"Alcool",
"",
"fluide"
],
[
"Psychotrope",
"",
""
]
],
"o": "matériel d'alchimiste",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "interdit",
"sp": "Apothicaire, Abstracteur"
},
{
"n": "Potion de peau de pierre",
"r": 3,
"h": 250,
"v": "5 500 po",
"i": [
[
"Baume d'altération",
"",
"fluide"
],
[
"Rocher",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "",
"sp": "Apothicaire, Abstracteur"
},
{
"n": "Potion de renouvellement",
"r": 3,
"h": 250,
"v": "5 500 po",
"i": [
[
"Décoction de guérison",
"",
"fluide"
],
[
"Stimulant",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Potion de vigueur",
"r": 3,
"h": 250,
"v": "5 500 po",
"i": [
[
"Décoction de guérison",
"",
"fluide"
],
[
"Stimulant",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Potion de guérison supérieure",
"r": 3,
"h": 120,
"v": "2 000 po",
"i": [
[
"Décoction de guérison",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Potion de santé majeure",
"r": 3,
"h": 250,
"v": "5 500 po",
"i": [
[
"Décoction de guérison",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 20,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Vie liquide",
"r": 3,
"h": 14,
"v": "300 po",
"i": [
[
"Essence de créature",
"Chair d'enfant tué",
"unique"
],
[
"Eau bénite",
"",
"fluide"
]
],
"o": "matériel d'alchimiste et kit d'alchimie",
"s": "Int",
"dd": 20,
"p": "Fluide, unique",
"f": "interdit",
"sp": "Alkahest, Apothicaire"
},
{
"n": "Potion d'absorption",
"r": 4,
"h": 500,
"v": "17 500 po",
"i": [
[
"Baume d'altération",
"",
"fluide"
],
[
"Essence élémentaire",
"Eau",
"volatil"
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 25,
"p": "fluide",
"f": "",
"sp": "Apothicaire, Abstracteur"
},
{
"n": "Potion de chance",
"r": 4,
"h": 500,
"v": "17 500 po",
"i": [
[
"Baume d'altération",
"",
"fluide"
],
[
"Gemme",
"",
""
]
],
"o": "matériel d'alchimiste",
"s": "Sag",
"dd": 25,
"p": "fluide",
"f": "réglementé",
"sp": "Apothicaire, Abstracteur"
},
{
"n": "Potion de guérison ultime",
"r": 4,
"h": 180,
"v": "20 000 po",
"i": [
[
"Décoction de guérison",
"",
"fluide"
],
[
"Médicinal",
"",
""
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 25,
"p": "fluide",
"f": "",
"sp": "Apothicaire"
},
{
"n": "Sang de troll",
"r": 4,
"h": 500,
"v": "17 500 po",
"i": [
[
"Décoction de guérison",
"",
"fluide"
],
[
"Essence de monstre",
"Sang de troll",
"unique"
]
],
"o": "kit d'herboristerie",
"s": "Sag",
"dd": 25,
"p": "fluide",
"f": "interdit",
"sp": "Apothicaire"
}
];
