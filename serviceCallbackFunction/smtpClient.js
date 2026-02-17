function sendMail(smtpConfig, mailOptions) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport(smtpConfig);
    return transporter.sendMail(mailOptions);
}

module.exports = {
    sendMail
};
