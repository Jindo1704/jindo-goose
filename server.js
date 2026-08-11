const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const rooms = {};
let lobbyChatHistory = []; 

// 무조건 한국 시간(KST)으로 변환해주는 함수
const getKSTTime = () => {
    return new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
};

// 🧹 주기적인 채팅 기록 청소 (1분마다 검사)
setInterval(() => {
    const now = Date.now();
    // 로비 채팅: 1시간(60분 * 60초 * 1000밀리초) 지난 메시지 삭제
    lobbyChatHistory = lobbyChatHistory.filter(chat => now - chat.timestamp < 60 * 60 * 1000);
    
    // 방 채팅: 30분(30분 * 60초 * 1000밀리초) 지난 메시지 삭제
    for (const roomName in rooms) {
        rooms[roomName].chatHistory = rooms[roomName].chatHistory.filter(chat => now - chat.timestamp < 30 * 60 * 1000);
    }
}, 60000);

io.on('connection', (socket) => {
    socket.join('lobby');
    
    // 처음 접속한 사람에게 로비 채팅 기록 쏴주기
    socket.emit('load_lobby_chat_history', lobbyChatHistory);

    const sendRoomList = () => {
        const roomList = Object.keys(rooms).map(roomName => ({
            roomName, userCount: rooms[roomName].users.length
        }));
        io.emit('room_list', roomList);
    };
    sendRoomList();

    socket.on('send_lobby_chat', (data) => {
        const chatData = { sender: data.sender, msg: data.msg, color: data.color, time: getKSTTime(), timestamp: Date.now() };
        lobbyChatHistory.push(chatData);
        io.to('lobby').emit('receive_lobby_chat', chatData);
    });

    socket.on('create_room', (data) => {
        if (rooms[data.room]) return socket.emit('room_error', '이미 존재하는 방 이름입니다.');
        
        // 빈 방 폭파 타이머(emptyTimeout)를 담을 수 있도록 추가
        rooms[data.room] = { password: data.password, users: [], snapshots: [], lines: [], chatHistory: [], emptyTimeout: null };
        sendRoomList();
        socket.emit('room_created', data.room);
    });

    socket.on('join_room', (data) => {
        const room = rooms[data.room];
        if (!room) return socket.emit('room_error', '존재하지 않는 방입니다.');
        if (room.password !== data.password) return socket.emit('room_error', '비밀번호가 틀렸습니다.');

        // ✨ 누군가 방에 들어왔으므로 '5분 폭파 타이머'가 있다면 취소!
        if (room.emptyTimeout) {
            clearTimeout(room.emptyTimeout);
            room.emptyTimeout = null;
        }

        socket.leave('lobby');
        socket.join(data.room);
        
        socket.room = data.room;
        socket.nickname = data.nickname;
        socket.color = data.color; 

        room.users.push({ id: socket.id, nickname: data.nickname, color: data.color });
        
        io.to(data.room).emit('update_user_list', room.users);
        socket.emit('load_room_chat_history', room.chatHistory);

        const sysMsg = { sender: '📢 시스템', msg: `${data.nickname}님이 입장하셨습니다.`, color: '#a6adc8', time: getKSTTime(), timestamp: Date.now() };
        room.chatHistory.push(sysMsg);
        io.to(data.room).emit('receive_chat', sysMsg);
        
        socket.emit('update_snapshots', room.snapshots);
        socket.emit('init_canvas', room.lines);
        
        socket.emit('join_success', data.room);
        sendRoomList();
    });

    socket.on('send_chat', (data) => {
        if (socket.room && rooms[socket.room]) {
            const chatData = { sender: socket.nickname, msg: data.msg, color: socket.color, time: getKSTTime(), timestamp: Date.now() };
            rooms[socket.room].chatHistory.push(chatData);
            io.to(socket.room).emit('receive_chat', chatData);
        }
    });

    socket.on('mouse_move', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('update_mouse', { id: socket.id, x: data.x, y: data.y, nickname: socket.nickname, color: socket.color });
        }
    });

    socket.on('draw_line', (data) => {
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room].lines.push(data);
            socket.to(socket.room).emit('receive_draw_line', data);
        }
    });

    socket.on('clear_canvas', () => {
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room].lines = [];
            socket.to(socket.room).emit('receive_clear_canvas');
        }
    });

    socket.on('save_snapshot', (data) => {
        if (socket.room && rooms[socket.room]) {
            const room = rooms[socket.room];
            const snapshotName = `Round ${room.snapshots.length + 1} (${getKSTTime()})`;
            room.snapshots.push({ name: snapshotName, data: data.snapshotData });
            
            const sysMsg = { sender: '📸 시스템', msg: `[${snapshotName}] 미니맵이 저장되었습니다.`, color: '#a6e3a1', time: getKSTTime(), timestamp: Date.now() };
            room.chatHistory.push(sysMsg);

            io.to(socket.room).emit('update_snapshots', room.snapshots);
            io.to(socket.room).emit('receive_chat', sysMsg);
        }
    });

    socket.on('update_input', (data) => socket.to(socket.room).emit('receive_input', data));
    socket.on('move_marker', (data) => socket.to(socket.room).emit('update_marker', data));
    socket.on('add_corpse', (data) => socket.to(socket.room).emit('receive_add_corpse', data));
    socket.on('remove_corpse', (data) => socket.to(socket.room).emit('receive_remove_corpse', data));
    socket.on('reset_markers', () => socket.to(socket.room).emit('receive_reset_markers'));
    socket.on('reset_all', () => socket.to(socket.room).emit('receive_reset_all'));

    socket.on('disconnect', () => {
        if (socket.room && rooms[socket.room]) {
            const room = rooms[socket.room];
            room.users = room.users.filter(u => u.id !== socket.id);
            
            io.to(socket.room).emit('update_user_list', room.users);
            
            const sysMsg = { sender: '📢 시스템', msg: `${socket.nickname}님이 퇴장하셨습니다.`, color: '#f38ba8', time: getKSTTime(), timestamp: Date.now() };
            room.chatHistory.push(sysMsg);
            io.to(socket.room).emit('receive_chat', sysMsg);
            io.to(socket.room).emit('remove_cursor', socket.id);
            
            // ✨ 혼자 남은 사람이 나갔을 때: 5분(300,000ms) 유예기간 타이머 시작
            if (room.users.length === 0) {
                room.emptyTimeout = setTimeout(() => {
                    delete rooms[socket.room];
                    sendRoomList(); // 5분 뒤 삭제 후 로비 목록 갱신
                }, 5 * 60 * 1000);
            }
            sendRoomList();
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`서버 실행됨: ${PORT}`));
