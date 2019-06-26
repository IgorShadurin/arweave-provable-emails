const fs = require('fs');
var imaps = require('imap-simple');
var nodemailer = require('nodemailer');
const Arweave = require('arweave/node');
const sha256 = require('sha256');
var btoa = require('btoa');


['./config.js', './wallet.json'].forEach(file => {
    if (!fs.existsSync(file)) {
        console.log('File not found: ' + file + '. Please, follow instructions in README.md');
        process.exit();
    }
});


const config = require('./config.js');

const arweave = Arweave.init({
    host: 'arweave.net',
    port: 80,
    protocol: 'https',
    timeout: 20000,
    logging: false,
});

const sendMail = (email, password, to, subject, arweaveHash) => {
    return new Promise((resolve, reject) => {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: email,
                pass: password
            }
        });

        const mailOptions = {
            from: email, // sender address
            to: to, // list of receivers
            subject: subject, // Subject line
            html: `<p>Your email stored here: https://arweave.net/${arweaveHash}. Please wait 10-30 minutes for the page to be available</p>`// plain text body
        };

        console.log(`Sending mail (to: ${to})...`);
        return transporter.sendMail(mailOptions, function (err, info) {
            if (err) {
                console.log('Error', err);
                reject(err);
            } else {
                console.log('Info', info);
                resolve(info);
            }
        });
    });
};

const uploadToArweave = async (html) => {
    let key = JSON.parse(fs.readFileSync('./wallet.json', 'utf8'));

    let transaction = await arweave.createTransaction({
        data: html,
    }, key);

    await arweave.transactions.sign(transaction, key);
    const response = await arweave.transactions.post(transaction);
    console.log('Transaction id', transaction.id);
    console.log('Status', response.status);

    return transaction.id;
};


const code = (email, password, template) => {
    return new Promise((resolve, reject) => {
        var c = {
            imap: {
                user: email,
                password: password,
                host: 'imap.gmail.com',
                port: 993,
                tls: true,
                authTimeout: 30000,
                tlsOptions: {
                    rejectUnauthorized: false
                }
            }
        };
        return imaps.connect(c)
            .then(function (connection) {
                return connection.openBox('INBOX')
                    .then(function () {
                        const searchCriteria = [
                            'UNSEEN'
                        ];

                        const fetchOptions = {
                            bodies: ['HEADER', 'TEXT'],
                            markSeen: true
                        };

                        return connection.search(searchCriteria, fetchOptions)
                            .then(function (results) {
                                const result = results.map(function (mail, index) {
                                    const body = mail.parts.find(function (part) {
                                        return part.which === 'TEXT';
                                    }).body;
                                    const header = mail.parts.find(function (part) {
                                        return part.which === 'HEADER';
                                    }).body;
                                    const subject = header.subject[0].trim();
                                    //const id =mail.attributes['x-gm-msgid'];
                                    const from = header.from[0].split("<")[1].split(">")[0];
                                    const date = header.date[0];


                                    var arr = [];
                                    for (var key in header) {
                                        if (header.hasOwnProperty(key)) {
                                            arr.push(key + ': ' + header[key]);
                                        }
                                    }
                                    var result = arr.join("\r\n");
                                    let full = result + "\r\n\r\n" + body;


                                    return {
                                        subject,
                                        from,
                                        date,
                                        body,
                                        full
                                    };
                                });

                                result.forEach((result, index) => {
                                    let html = fs.readFileSync(template, 'utf8');
                                    const hash = sha256(result.body);
                                    html = html
                                        .replace('{emailFrom}', result.from)
                                        .replace('{emailSubject}', result.subject)
                                        .replace('{emailDate}', result.date)
                                        .replace('{contentHash}', hash)
                                        .replace('{emailContent}', btoa(result.full));
                                    //fs.writeFileSync('file___' + index + '.html', html);
                                    console.log('Upload file to arweave...');
                                    uploadToArweave(html)
                                        .then(hash => {
                                            console.log('Uploaded!');
                                            console.log(hash);
                                            return sendMail(email, password, result.from, 'Email saved to Arweave', hash)
                                                .then(data => {
                                                    console.log(data);
                                                });
                                        });
                                });


                                resolve(result);
                            });
                    });
            });
    });
};

console.log('Receive mails...');
code(config.full.email, config.full.password, 'template_full.html')
    .then((mails) => {
        console.log('Full mails received');
    });
code(config.sign.email, config.sign.password, 'template_sign.html')
    .then((mails) => {
        console.log('Sign mails received');
    });


setTimeout(_ => {
    process.exit();
}, 120000);
