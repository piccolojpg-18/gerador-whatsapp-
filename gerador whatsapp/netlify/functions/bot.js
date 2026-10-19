const Jimp = require('jimp');

exports.handler = async (event) => {
    // ---------------------------------------------------------------------
    // 1. CREDENCIAIS E CONFIGURAÇÕES
    // ---------------------------------------------------------------------
    const TELEGRAM_TOKEN  = (process.env.TELEGRAM_TOKEN || "8309547479:AAFsKIWFZXo_P-_8EFOKHbguLK0x-FHrSwk").trim();
    const DESTINO_ID      = (process.env.TELEGRAM_DESTINO_ID || "-1003995114810").trim();

    // LINK FIXO DE AFILIADO
    const LINK_AFILIADO_FIXO = "https://s.shopee.com.br/qgzuF8WWh";

    // ---------------------------------------------------------------------
    // 2. FUNÇÕES AUXILIARES DE IMAGEM E ENVIO
    // ---------------------------------------------------------------------

    // Baixa a foto do Telegram e retorna Buffer
    async function baixarFotoTelegram(fileId) {
        try {
            const resFile = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
            const dataFile = await resFile.json();
           
            if (dataFile.ok && dataFile.result && dataFile.result.file_path) {
                const urlDownload = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${dataFile.result.file_path}`;
                const resImg = await fetch(urlDownload);
                return {
                    buffer: Buffer.from(await resImg.arrayBuffer()),
                    urlOriginal: urlDownload
                };
            }
        } catch (err) {
            console.error("❌ Erro ao baixar foto do Telegram:", err);
        }
        return null;
    }

    // Corta a imagem (remove bordas rosas)
    async function cortarImagemProduto(bufferOriginal) {
        try {
            const image = await Jimp.read(bufferOriginal);
            
            const largura = image.getWidth();
            const altura = image.getHeight();

            const pctTopo = 0.075;    
            const pctBase = 0.315;    
            const pctEsquerda = 0.11; 
            const pctDireita = 0.11;  

            const inicioX = Math.floor(largura * pctEsquerda);
            const inicioY = Math.floor(altura * pctTopo);

            const novaLargura = largura - Math.floor(largura * pctEsquerda) - Math.floor(largura * pctDireita);
            const novaAltura = altura - Math.floor(altura * pctTopo) - Math.floor(altura * pctBase);

            image.crop(inicioX, inicioY, novaLargura, novaAltura);

            return await image.getBufferAsync(Jimp.MIME_JPEG);
        } catch (err) {
            console.error("❌ Erro no Jimp ao cortar:", err);
            return bufferOriginal; // Retorna a foto sem corte caso o Jimp falhe
        }
    }

    // Envia foto para o Telegram usando multipart/form-data via Boundary
    async function enviarFotoTelegram(chatId, bufferFoto, legenda) {
        if (!TELEGRAM_TOKEN) return;
        try {
            const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
            
            let header = `--${boundary}\r\n`;
            header += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
            
            if (legenda) {
                header += `--${boundary}\r\n`;
                header += `Content-Disposition: form-data; name="caption"\r\n\r\n${legenda}\r\n`;
            }
            
            header += `--${boundary}\r\n`;
            header += `Content-Disposition: form-data; name="photo"; filename="oferta.jpg"\r\n`;
            header += `Content-Type: image/jpeg\r\n\r\n`;

            const footer = `\r\n--${boundary}--\r\n`;

            const payload = Buffer.concat([
                Buffer.from(header, 'utf-8'),
                bufferFoto,
                Buffer.from(footer, 'utf-8')
            ]);

            const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`
                },
                body: payload
            });

            const resJson = await response.json();
            if (!resJson.ok) {
                console.error("❌ Telegram rejeitou a foto:", resJson);
                // Fallback: tenta enviar só texto se a foto falhar
                await enviarTextoTelegram(chatId, legenda);
            } else {
                console.log("✅ Foto enviada com sucesso para o Telegram!");
            }
        } catch (err) {
            console.error(`❌ Erro ao disparar foto para Telegram (${chatId}):`, err);
            await enviarTextoTelegram(chatId, legenda);
        }
    }

    async function enviarTextoTelegram(chatId, texto) {
        if (!TELEGRAM_TOKEN) return;
        try {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: texto })
            });
        } catch (err) {
            console.error(`❌ Erro texto Telegram (${chatId}):`, err);
        }
    }

    // ---------------------------------------------------------------------
    // 3. PROCESSAMENTO DAS MENSAGENS RECEBIDAS
    // ---------------------------------------------------------------------
    if (event.httpMethod === "POST") {
        let body = {};
        try {
            body = JSON.parse(event.body || "{}");
        } catch (e) {
            return { statusCode: 400, body: "JSON Inválido" };
        }

        const message = body.message || body.channel_post || body;
        if (!message) return { statusCode: 200, body: "Sem mensagem" };

        const textoOriginal = message.text || message.caption || "";
        const chatOrigemId = message.chat ? String(message.chat.id) : null;

        if (!chatOrigemId) return { statusCode: 200, body: "Sem chat de origem" };

        // Pega a foto (seja mensagem normal ou encaminhada)
        let fileIdFoto = null;
        if (message.photo && message.photo.length > 0) {
            fileIdFoto = message.photo[message.photo.length - 1].file_id;
        }

        // 1. Trata o texto (remove carrinho e limpa links excedentes)
        let textoTratado = textoOriginal.replace(/🛒 LINK CARRINHO:.*?\n?/gi, '');

        const linksEncontrados = textoTratado.match(/https?:\/\/[^\s]+/g);
        if (linksEncontrados && linksEncontrados.length > 0) {
            textoTratado = textoTratado.replace(linksEncontrados[0], LINK_AFILIADO_FIXO);
            for (let i = 1; i < linksEncontrados.length; i++) {
                textoTratado = textoTratado.replace(linksEncontrados[i], '');
            }
        }

        textoTratado = textoTratado.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

        // 2. Baixa e processa a foto
        let bufferFotoFinal = null;
        if (fileIdFoto) {
            const fotoDownload = await baixarFotoTelegram(fileIdFoto);
            if (fotoDownload && fotoDownload.buffer) {
                bufferFotoFinal = await cortarImagemProduto(fotoDownload.buffer);
            }
        }

        // 3. Envia para o grupo/canal de destino
        if (bufferFotoFinal) {
            await enviarFotoTelegram(DESTINO_ID, bufferFotoFinal, textoTratado);
        } else {
            await enviarTextoTelegram(DESTINO_ID, textoTratado);
        }

        return { statusCode: 200, body: "Processado com sucesso" };
    }

    return { statusCode: 200, body: "Servidor Ativo" };
};