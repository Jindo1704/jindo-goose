const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const rooms = {};
let lobbyChatHistory = []; 

const getKSTTime = () => {
    return new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
};

// 🧹 주기적인 채팅 기록 청소 (1분마다 실행)
setInterval(() => {
    const now = Date.now();
    lobbyChatHistory = lobbyChatHistory.filter(chat => now - chat.timestamp < 60 * 60 * 1000);
    
    for (const roomName in rooms) {
        rooms[roomName].chatHistory = rooms[roomName].chatHistory.filter(chat => now - chat.timestamp < 30 * 60 * 1000);
    }
}, 60000);

io.on('connection', (socket) => {
    socket.join('lobby');
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
        rooms[data.room] = { password: data.password, users: [], snapshots: [], lines: [], chatHistory: [] };
        sendRoomList();
        socket.emit('room_created', data.room);
    });

    socket.on('join_room', (data) => {
        const room = rooms[data.room];
        if (!room) return socket.emit('room_error', '존재하지 않는 방입니다.');
        if (room.password !== data.password) return socket.emit('room_error', '비밀번호가 틀렸습니다.');

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
            
            // ✨ [핵심 수정] 이제 혼자 있다가 나가도(새로고침 해도) 방이 폭파되지 않습니다!
            // if (room.users.length === 0) delete rooms[socket.room]; 
            
            sendRoomList();
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`서버 실행됨: ${PORT}`));
