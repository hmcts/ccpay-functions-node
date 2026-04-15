function sendMail(smtpConfig, mailOptions) {
    const nodemailer = require('nodemailer');
    const secureSmtpConfig = {
        ...smtpConfig,
        requireTLS: true,
        ignoreTLS: false,
        tls: {
            minVersion: 'TLSv1.2',
            rejectUnauthorized: true,
            ...(smtpConfig && smtpConfig.tls ? smtpConfig.tls : {})
        }
    };
    const transporter = nodemailer.createTransport(secureSmtpConfig);
    return transporter.sendMail(mailOptions);
}

module.exports = {
    sendMail
};
