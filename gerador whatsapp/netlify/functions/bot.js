const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

// Memória em escopo global da Lambda
let bancoDeCupons = [];

exports.handler = async (event) => {
    // ---------------------------------------------------------------------
    // 1. CREDENCIAIS E CONFIGURAÇÕES
    // ---------------------------------------------------------------------
    const TELEGRAM_TOKEN  = (process.env.TELEGRAM_TOKEN || "8309547479:AAFsKIWFZXo_P-_8EFOKHbguLK0x-FHrSwk").trim();
    const DESTINO_ID      = (process.env.TELEGRAM_DESTINO_ID || "-1003995114810").trim(); // Chat de Gatilhos Prontos

    // SEU LINK FIXO DE AFILIADO SHOPEE PARA SUBSTITUIÇÃO
    const LINK_AFILIADO_FIXO = "https://s.shopee.com.br/qgzuF8WWh";

    // NOME EXATO DO ARQUIVO DA IMAGEM NA RAIZ DO REPOSITÓRIO DO GIT
    const NOME_ARQUIVO_IMAGEM = "imagem.jpg"; 

    const GREEN_API_URL   = "https://7107.api.greenapi.com";
    const GREEN_INSTANCE  = "710722716500";
    const GREEN_TOKEN     = "993528f5ad8a470aa234774dc361ae4beaec1cc875cb460ea4";

    const WHATSAPP_CHAT_IDS = [
        process.env.GREEN_CHAT_ID_1 || "120363418129195027@g.us",
        process.env.GREEN_CHAT_ID_2 || "120363402975417220@g.us",
        process.env.GREEN_CHAT_ID_3 || "120363421498616404@g.us"
    ]
    .map(id => (id || "").trim())
    .filter(id => id.length > 0);

    // ---------------------------------------------------------------------
    // 2. FUNÇÕES AUXILIARES DE IMAGEM E ENVIO
    // ---------------------------------------------------------------------

    // Carrega a imagem local da raiz do projeto (Git)
    async function carregarImagemLocal() {
        try {
            const caminhoImagem = path.join(__dirname, NOME_ARQUIVO_IMAGEM);
            if (fs.existsSync(caminhoImagem)) {
                return fs.readFileSync(caminhoImagem);
            } else {
                console.error(`❌ O arquivo '${NOME_ARQUIVO_IMAGEM}' não foi encontrado em: ${caminhoImagem}`);
            }
        } catch (err) {
            console.error("❌ Erro ao ler a imagem local do projeto:", err);
        }
        return null;
    }

    // Recorta exatamente o quadrado do produto, removendo bordas rosas, topo e rodapé
    async function cortarImagemProduto(bufferOriginal) {
        try {
            const image = await Jimp.read(bufferOriginal);
            
            const largura = image.getWidth();
            const altura = image.getHeight();

            // Percentuais de corte exatos
            const pctTopo = 0.075;    // Corta topo rosa (7.5%)
            const pctBase = 0.315;    // Corta texto, preço e rodapé rosa (31.5%)
            const pctEsquerda = 0.11; // Corta lateral esquerda rosa (11%)
            const pctDireita = 0.11;  // Corta lateral direita rosa (11%)

            const inicioX = Math.floor(largura * pctEsquerda);
            const inicioY = Math.floor(altura * pctTopo);

            const novaLargura = largura - Math.floor(largura * pctEsquerda) - Math.floor(largura * pctDireita);
            const novaAltura = altura - Math.floor(altura * pctTopo) - Math.floor(altura * pctBase);

            image.crop(inicioX, inicioY, novaLargura, novaAltura);

            return await image.getBufferAsync(Jimp.MIME_JPEG);
        } catch (err) {
            console.error("❌ Erro no processamento com Jimp:", err);
            return bufferOriginal;
        }
    }

    // Envia imagem recortada (Buffer) para o Telegram com Boundary manual
    async function enviarFotoTelegram(chatId, bufferFoto, legenda) {
        if (!TELEGRAM_TOKEN) return;
        try {
            const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
            
            let header = `--${boundary}\r\n`;
            header += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
            
            if (legenda) {
                header += `--${boundary}\r\n`;
                header += `Content-Disposition: form-data; name="caption"\r\n\r\n${legenda}\r\n`;
                header += `Content-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdown\r\n`;
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
                await enviarTextoTelegram(chatId, legenda);
            } else {
                console.log("✅ Foto local enviada com sucesso para o Telegram!");
            }
        } catch (err) {
            console.error(`❌ Erro foto Telegram (${chatId}):`, err);
            await enviarTextoTelegram(chatId, legenda);
        }
    }

    // Envia texto simples para o Telegram
    async function enviarTextoTelegram(chatId, texto) {
        if (!TELEGRAM_TOKEN) return;
        try {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' })
            });
        } catch (err) {
            console.error(`❌ Erro texto Telegram (${chatId}):`, err);
        }
    }

    // Envia mensagem/foto para o WhatsApp via Green-API (Atualmente bloqueado/desativado)
    async function enviarWhatsapp(texto, chatId, bufferFoto = null) {
        const endpoint = bufferFoto ? "sendFileByUpload" : "sendMessage";
        const url = `${GREEN_API_URL}/waInstance${GREEN_INSTANCE}/${endpoint}/${GREEN_TOKEN}`;

        try {
            if (bufferFoto) {
                const formData = new FormData();
                formData.append('chatId', chatId);
                formData.append('caption', texto);
                const blob = new Blob([bufferFoto], { type: 'image/jpeg' });
                formData.append('file', blob, 'oferta.jpg');

                const resp = await fetch(url, { method: 'POST', body: formData });
                return await resp.json();
            } else {
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatId: chatId, message: texto })
                });
                return await resp.json();
            }
        } catch (err) {
            console.error(`❌ Erro WhatsApp (${chatId}):`, err);
            return null;
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

        const message = body.message || body;
        if (!message) return { statusCode: 200, body: "Sem mensagem" };

        const textoOriginal = message.text || message.caption || "";
        const chatOrigemId = message.chat ? String(message.chat.id) : null;

        if (!chatOrigemId) return { statusCode: 200, body: "Sem chat de origem" };

        const linhasMsg = textoOriginal.split('\n');
        const primeiraLinha = linhasMsg[0].trim().toLowerCase();

        // =================================================================
        // CASO 1: ATIVAÇÃO DE CUPONS (#ativar)
        // =================================================================
        if (primeiraLinha === "#ativar") {
            const linhasTratadas = linhasMsg.slice(1).map(l => l.trim()).filter(l => l.length > 0);
           
            let cuponsParaSalvar = [];
            for (let i = 0; i < linhasTratadas.length; i++) {
                let linhaAtual = linhasTratadas[i];
               
                if (linhasTratadas[i + 1] && linhasTratadas[i + 1].toUpperCase().startsWith("CUPOM:")) {
                    let codigo = linhasTratadas[i + 1].split(":")[1].trim();
                    cuponsParaSalvar.push(`${linhaAtual} | CODIGO:${codigo}`);
                    i++;
                } else if (!linhaAtual.toUpperCase().startsWith("CUPOM:")) {
                    cuponsParaSalvar.push(linhaAtual);
                }
            }

            for (let item of cuponsParaSalvar) {
                if (!bancoDeCupons.includes(item)) bancoDeCupons.push(item);
            }

            if (chatOrigemId === String(DESTINO_ID)) {
                await enviarTextoTelegram(chatOrigemId, "🚀 Cupons adicionados e ativos!");
            }
            return { statusCode: 200, body: "Cupons Ativados" };
        }

        // =================================================================
        // CASO 2: REMOÇÃO DE CUPONS (#cancelar)
        // =================================================================
        if (primeiraLinha === "#cancelar") {
            const termoBusca = linhasMsg.slice(1).join(" ").trim().toLowerCase();
            bancoDeCupons = bancoDeCupons.filter(c => !c.toLowerCase().includes(termoBusca));

            if (chatOrigemId === String(DESTINO_ID)) {
                await enviarTextoTelegram(chatOrigemId, "🛑 Cupons removidos!");
            }
            return { statusCode: 200, body: "Cupons Cancelados" };
        }

        // =================================================================
        // CASO 3: MENSAGEM ENCAMINHADA / CUPOM DE OFERTA
        // =================================================================
        // Remove linhas de carrinho excedentes
        let textoTratado = textoOriginal.replace(/🛒 LINK CARRINHO:.*?\n?/gi, '');

        // Substitui TODOS os links originais do texto pelo seu link fixo de afiliado
        const linksEncontrados = textoTratado.match(/https?:\/\/[^\s]+/g);
        if (linksEncontrados && linksEncontrados.length > 0) {
            textoTratado = textoTratado.replace(linksEncontrados[0], LINK_AFILIADO_FIXO);
            for (let i = 1; i < linksEncontrados.length; i++) {
                textoTratado = textoTratado.replace(linksEncontrados[i], '');
            }
        }

        textoTratado = textoTratado.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

        // Carrega a imagem local do projeto e corta com o Jimp
        let bufferCortado = null;
        const bufferLocal = await carregarImagemLocal();
        if (bufferLocal) {
            bufferCortado = await cortarImagemProduto(bufferLocal);
        }

        // 1. Envio para o Telegram (Destino) com a imagem local
        if (bufferCortado) {
            await enviarFotoTelegram(DESTINO_ID, bufferCortado, textoTratado);
        } else {
            await enviarTextoTelegram(DESTINO_ID, textoTratado);
        }

        // 2. Envio para os grupos do WhatsApp via Green-API -> BLOQUEADO/DESATIVADO TEMPORARIAMENTE
        /*
        const respostaWhatsapp = converterFormatacaoWhatsapp(textoTratado);
        for (const chatId of WHATSAPP_CHAT_IDS) {
            await enviarWhatsapp(respostaWhatsapp, chatId, bufferCortado);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        */

        return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "Servidor Ativo" };
};
